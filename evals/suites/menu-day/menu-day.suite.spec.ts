import {
  MENU_DAY_MAX_OUTPUT_TOKENS,
  MENU_MAX_DAYS,
  MENU_MEAL_MAX_OUTPUT_TOKENS,
  MENU_PLAN_MAX_ATTEMPTS,
  MENU_PLAN_MEAL_TYPES,
  MealType,
  menuDayRetryMessage,
  MenuIssueSeverity,
  menuMealRetryMessage,
} from '../../../src/common/constants';
import { MenuDayPlan, MenuDayPlanSchema, MenuMealPlanSchema } from '../../../src/common/contracts';
import { AssistantInvalidOutputException } from '../../../src/common/exceptions';
import { otherDaysRecipeIds } from '../../../src/modules/services/menu/menu-day';
import {
  fitsDayKcal,
  menuRecipeIds,
  otherMealsKcal,
} from '../../../src/modules/services/menu/menu-meal';
import { PlannedDay } from '../../../src/modules/services/menu/menu-plan';
import { ModelResult, OpenAiService } from '../../../src/providers/open-ai/open-ai.service';
import { createMock } from '../../../src/test/create-mock';
import { loadCases } from '../../lib/cases';
import { MENU_PLAN_PROFILES, MENU_PLAN_RECIPES } from '../menu-plan/menu-plan.suite';
import {
  composeDay,
  dayCandidates,
  MenuDayCase,
  MenuDayCaseSchema,
  MenuDayOutput,
  menuDaySuite,
  plannedMeals,
  previousDays,
  replacedDays,
  scoreMenuDay,
} from './menu-day.suite';

const recipeOf = (mealType: string, i: number): string =>
  MENU_PLAN_RECIPES.filter((recipe) => recipe.mealType === mealType)[i].name;

describe('menu-day suite', () => {
  const day = (i: number): MenuDayCase['previous'][number] => ({
    breakfast: recipeOf('breakfast', i),
    lunch: recipeOf('lunch', i),
    snack: recipeOf('snack', i),
    dinner: recipeOf('dinner', i),
  });
  const theCase: MenuDayCase = {
    id: 'c',
    tags: [],
    profile: 'basic',
    request: 'Plan a 3-day menu with day 2 planned again.',
    previous: [day(0), day(1), day(2)],
    dayIndex: 1,
    mealType: null,
    rotation: 0,
  };
  const { candidates } = dayCandidates(theCase);
  const plan = (meals: PlannedDay): MenuDayPlan => ({ message: 'New day.', meals });
  /** The first meals of the candidates that pass every field, found by trying them. */
  const good = ((): MenuDayPlan => {
    const [b, l, s, d] = MENU_PLAN_MEAL_TYPES.map((mealType) => candidates[mealType]);
    for (const breakfast of b) {
      for (const lunch of l) {
        for (const snack of s) {
          for (const dinner of d) {
            const candidate = plan({
              breakfast: breakfast.id,
              lunch: lunch.id,
              snack: snack.id,
              dinner: dinner.id,
            });
            if (scoreMenuDay(theCase, candidate).every(({ pass }) => pass)) {
              return candidate;
            }
          }
        }
      }
    }
    throw new Error('No day of the candidates passes');
  })();
  const score = (output: MenuDayPlan | null): Record<string, boolean> =>
    Object.fromEntries(scoreMenuDay(theCase, output).map(({ field, pass }) => [field, pass]));

  describe('dayCandidates', () => {
    it('offers the candidates of one day without the recipes of the other days', () => {
      const excluded = otherDaysRecipeIds(previousDays(theCase), theCase.dayIndex);
      const { candidates: offered, recipeIds } = dayCandidates(theCase);

      for (const mealType of MENU_PLAN_MEAL_TYPES) {
        expect(offered[mealType].length).toBeGreaterThan(0);
        expect(offered[mealType].every(({ id }) => !excluded.has(recipeIds.get(id)!))).toBe(true);
      }
    });
  });

  describe('replacedDays', () => {
    it('puts the planned day in and keeps the other days of the previous menu as they are', () => {
      const days = replacedDays(theCase, good.meals);
      const previous = previousDays(theCase);

      expect(JSON.stringify(days[0])).toBe(JSON.stringify(previous[0]));
      expect(JSON.stringify(days[2])).toBe(JSON.stringify(previous[2]));
      expect(days[1].meals.map(({ recipeId }) => recipeId)).toEqual(
        MENU_PLAN_MEAL_TYPES.map((mealType) =>
          dayCandidates(theCase).recipeIds.get(good.meals[mealType]),
        ),
      );
    });

    it('composes the whole menu with the planned day', () => {
      expect(composeDay(theCase, good.meals).days).toHaveLength(3);
    });
  });

  describe('scoreMenuDay', () => {
    it('passes a day of candidates on target without errors or disliked foods', () => {
      expect(Object.values(score(good)).every(Boolean)).toBe(true);
    });

    it('fails an id that is not a candidate, and every field it leaves unscored', () => {
      expect(score(plan({ ...good.meals, lunch: 'l99' }))).toEqual({
        candidates: false,
        unchanged: false,
        exclusions: false,
        validation: false,
        calories: false,
        disliked: false,
      });
    });

    it('lets a recipe of another day pass for a meal the other days use up', () => {
      const vegan = loadCases(menuDaySuite.casesFile, menuDaySuite.caseSchema).find(
        ({ id }) => id === 'days-7-tuesday-vegan',
      )!;
      const { candidates: offered, recipeIds } = dayCandidates(vegan);
      const excluded = otherDaysRecipeIds(previousDays(vegan), vegan.dayIndex);
      const meals = Object.fromEntries(
        MENU_PLAN_MEAL_TYPES.map((mealType) => [mealType, offered[mealType][0].id]),
      ) as PlannedDay;

      expect(offered.breakfast.every(({ id }) => excluded.has(recipeIds.get(id)!))).toBe(true);
      expect(
        scoreMenuDay(vegan, plan(meals)).find(({ field }) => field === 'exclusions')?.pass,
      ).toBe(true);
    });

    it('fails every field on output that did not match the schema', () => {
      expect(scoreMenuDay(theCase, null).every(({ pass }) => !pass)).toBe(true);
    });
  });

  describe('run', () => {
    const usage = { inputTokens: 1000, cachedInputTokens: 100, outputTokens: 50 };
    const wrong = plan({ ...good.meals, lunch: 'x' });
    const result = (output: MenuDayPlan): ModelResult<MenuDayPlan> => ({
      output,
      modelId: 'm',
      latencyMs: 10,
      usage,
    });
    let openAi: jest.Mocked<OpenAiService>;

    beforeEach(() => {
      openAi = createMock<OpenAiService>();
    });

    it('runs the day call of the app with the candidates of the case', async () => {
      openAi.generateStructuredResult.mockResolvedValue(result(good) as never);

      await expect(menuDaySuite.run(theCase, openAi)).resolves.toEqual({
        ...result(good),
        metrics: { repairs: 0 },
      });

      const [[input, schema, options]] = openAi.generateStructuredResult.mock.calls;
      expect(schema).toBe(MenuDayPlanSchema);
      expect(options.maxOutputTokens).toBe(MENU_DAY_MAX_OUTPUT_TOKENS);
      const sent = JSON.parse((input as Array<{ content: string }>)[0].content);
      expect(sent).toMatchObject({ request: theCase.request, dayIndex: 1 });
      expect(sent.recipes).toEqual(candidates);
    });

    it('sends a day with problems back and counts the repairs, usage and latency of every call', async () => {
      openAi.generateStructuredResult
        .mockResolvedValueOnce(result(wrong) as never)
        .mockResolvedValueOnce(result(good) as never);

      await expect(menuDaySuite.run(theCase, openAi)).resolves.toEqual({
        output: good,
        modelId: 'm',
        latencyMs: 20,
        usage: { inputTokens: 2000, cachedInputTokens: 200, outputTokens: 100 },
        metrics: { repairs: 1 },
      });
      const [, [messages]] = openAi.generateStructuredResult.mock.calls;
      expect((messages as Array<{ content: string }>).at(-1)?.content).toBe(
        menuDayRetryMessage(['dayIndex 1, lunch: "x" is not an id from the lunch recipes.']),
      );
    });

    it('returns the last day after the last attempt', async () => {
      openAi.generateStructuredResult.mockResolvedValue(result(wrong) as never);

      await expect(menuDaySuite.run(theCase, openAi)).resolves.toMatchObject({
        output: wrong,
        metrics: { repairs: MENU_PLAN_MAX_ATTEMPTS - 1 },
      });
    });

    it('fails invalid output with the usage of every call', async () => {
      openAi.generateStructuredResult
        .mockResolvedValueOnce(result(wrong) as never)
        .mockRejectedValueOnce(new AssistantInvalidOutputException({ modelId: 'm', usage }));

      const error = await menuDaySuite.run(theCase, openAi).catch((e: unknown) => e);

      expect((error as AssistantInvalidOutputException).call).toEqual({
        modelId: 'm',
        usage: { inputTokens: 2000, cachedInputTokens: 200, outputTokens: 100 },
      });
    });
  });

  describe('a meal', () => {
    const mealCase: MenuDayCase = {
      ...theCase,
      request: 'Plan a 3-day menu with another dinner on day 2.',
      mealType: MealType.Dinner,
    };
    const { candidates: offered, recipeIds } = dayCandidates(mealCase);
    const mealScore = (output: MenuDayOutput | null): Record<string, boolean> =>
      Object.fromEntries(scoreMenuDay(mealCase, output).map(({ field, pass }) => [field, pass]));
    const goodMeal = ((): MenuDayOutput => {
      for (const { id } of offered.dinner) {
        const candidate = { message: 'New dinner.', meals: { dinner: id } };
        if (scoreMenuDay(mealCase, candidate).every(({ pass }) => pass)) {
          return candidate;
        }
      }
      throw new Error('No dinner of the candidates passes');
    })();

    it('offers only the recipes of the meal that the menu does not serve and that keep the day within its calories', () => {
      const previous = previousDays(mealCase);
      const served = menuRecipeIds(previous);
      const other = otherMealsKcal(previous[1], MealType.Dinner);
      const goal = MENU_PLAN_PROFILES.basic.nutritionGoal!.caloriesKcal;

      expect(offered.dinner.length).toBeGreaterThan(0);
      for (const { id, perServing } of offered.dinner) {
        expect(served.has(recipeIds.get(id)!)).toBe(false);
        expect(fitsDayKcal(perServing.kcal, other, goal)).toBe(true);
      }
      expect([...offered.breakfast, ...offered.lunch, ...offered.snack]).toEqual([]);
    });

    it('replaces only the meal, with the servings closest to the goal', () => {
      const days = replacedDays(mealCase, goodMeal.meals);
      const previous = previousDays(mealCase);

      expect(JSON.stringify(days[0])).toBe(JSON.stringify(previous[0]));
      expect(JSON.stringify(days[2])).toBe(JSON.stringify(previous[2]));
      expect(JSON.stringify(days[1].meals.slice(0, 3))).toBe(
        JSON.stringify(previous[1].meals.slice(0, 3)),
      );
      expect(days[1].meals[3].recipeId).toBe(recipeIds.get(goodMeal.meals.dinner!));
    });

    it('passes a candidate that keeps the day within its calories', () => {
      expect(Object.values(mealScore(goodMeal)).every(Boolean)).toBe(true);
    });

    it('fails a recipe that is not a candidate, and every field it leaves unscored', () => {
      expect(mealScore({ message: 'x', meals: { dinner: 'd99' } })).toEqual({
        candidates: false,
        unchanged: false,
        exclusions: false,
        validation: false,
        calories: false,
        disliked: false,
      });
    });

    it('runs the meal call of the app and returns the recipe by its meal type', async () => {
      const openAi = createMock<OpenAiService>();
      const usage = { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 };
      openAi.generateStructuredResult
        .mockResolvedValueOnce({
          output: { message: 'x', recipe: 'd99' },
          modelId: 'm',
          latencyMs: 1,
          usage,
        } as never)
        .mockResolvedValueOnce({
          output: { message: 'New dinner.', recipe: goodMeal.meals.dinner },
          modelId: 'm',
          latencyMs: 1,
          usage,
        } as never);

      await expect(menuDaySuite.run(mealCase, openAi)).resolves.toEqual({
        output: goodMeal,
        modelId: 'm',
        latencyMs: 2,
        usage: { inputTokens: 2, cachedInputTokens: 0, outputTokens: 2 },
        metrics: { repairs: 1 },
      });
      const [[input, schema, options], [retry]] = openAi.generateStructuredResult.mock.calls;
      expect(schema).toBe(MenuMealPlanSchema);
      expect(options.maxOutputTokens).toBe(MENU_MEAL_MAX_OUTPUT_TOKENS);
      const sent = JSON.parse((input as Array<{ content: string }>)[0].content);
      expect(sent).toMatchObject({ dayIndex: 1, mealType: MealType.Dinner });
      expect(sent.recipes).toEqual(offered.dinner);
      expect((retry as Array<{ content: string }>).at(-1)?.content).toBe(
        menuMealRetryMessage(['dayIndex 1, dinner: "d99" is not an id from the dinner recipes.']),
      );
    });
  });

  it.each([
    ['a day outside the menu', { dayIndex: 3 }],
    ['a menu of one day', { previous: [day(0)], dayIndex: 0 }],
    ['an unknown recipe', { previous: [day(0), { ...day(1), lunch: 'Nope' }] }],
  ])('rejects a case with %s', (_case, overrides) => {
    expect(MenuDayCaseSchema.safeParse({ ...theCase, ...overrides }).success).toBe(false);
  });

  describe('cases.jsonl', () => {
    const cases = loadCases(menuDaySuite.casesFile, menuDaySuite.caseSchema);

    it('redoes the first, a middle and the last day, and every meal of a day', () => {
      for (const tag of ['first', 'middle', 'last']) {
        expect(cases.some((c) => c.tags.includes(tag) && c.mealType === null)).toBe(true);
      }
      for (const mealType of MENU_PLAN_MEAL_TYPES) {
        expect(cases.some((c) => c.mealType === mealType)).toBe(true);
      }
    });

    it('replaces meals that some candidate can keep within the calories of the day', () => {
      for (const c of cases.filter(({ mealType }) => mealType !== null)) {
        const day = previousDays(c)[c.dayIndex];
        const goal = MENU_PLAN_PROFILES[c.profile].nutritionGoal!.caloriesKcal;
        const { candidates: offered } = dayCandidates(c);
        expect(
          offered[c.mealType as 'dinner'].some(({ perServing }) =>
            fitsDayKcal(perServing.kcal, otherMealsKcal(day, c.mealType!), goal),
          ),
        ).toBe(true);
      }
    });

    it('covers a week and every profile', () => {
      expect(cases.some((c) => c.previous.length === MENU_MAX_DAYS)).toBe(true);
      for (const profile of ['basic', 'vegan', 'vegetarian', 'allergy', 'low_kcal']) {
        expect(cases.some((c) => c.profile === profile)).toBe(true);
      }
    });

    it('starts every case from a menu without errors', () => {
      for (const c of cases) {
        const days = previousDays(c);
        const meals = days[c.dayIndex].meals;
        const { recipeIds } = dayCandidates(c);
        const anyCandidate = Object.fromEntries(
          plannedMeals(c).map((mealType) => [
            mealType,
            dayCandidates(c).candidates[mealType][0].id,
          ]),
        ) as PlannedDay;
        expect(meals).toHaveLength(MENU_PLAN_MEAL_TYPES.length);
        expect(recipeIds.size).toBeGreaterThan(0);
        const otherErrors = composeDay(c, anyCandidate).issues.filter(
          (issue) => issue.severity === MenuIssueSeverity.Error && issue.dayIndex !== c.dayIndex,
        );
        expect(otherErrors).toEqual([]);
      }
    });
  });
});
