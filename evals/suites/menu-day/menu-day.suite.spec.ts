import {
  MENU_DAY_MAX_OUTPUT_TOKENS,
  MENU_MAX_DAYS,
  MENU_MEAL_MAX_OUTPUT_TOKENS,
  MENU_PLAN_MAX_ATTEMPTS,
  MENU_PLAN_MEAL_TYPES,
  MENU_PLAN_PROMPT,
  MealType,
  menuDayRetryMessage,
} from '../../../src/common/constants';
import {
  MenuDayPlanSchema,
  MenuMealPlanSchema,
  MenuPlanSchema,
} from '../../../src/common/contracts';
import { AssistantInvalidOutputException } from '../../../src/common/exceptions';
import { ModelUsage } from '../../../src/common/types';
import { MenuPlanCandidates } from '../../../src/modules/services/menu/menu-plan';
import {
  replaceParts,
  ReplacementModelCall,
} from '../../../src/modules/services/menu/menu-replacement';
import { ModelResult, OpenAiService } from '../../../src/providers/open-ai/open-ai.service';
import { createMock } from '../../../src/test/create-mock';
import { loadCases } from '../../lib/cases';
import {
  allowedRecipes,
  MENU_PLAN_PROFILES,
  MENU_PLAN_RECIPES,
} from '../menu-plan/menu-plan.suite';
import {
  caseProfile,
  caseReplacement,
  MenuDayCase,
  MenuDayCaseSchema,
  MenuDayOutput,
  menuDaySuite,
  planWholeMenu,
  previousDays,
  replacementInput,
  scoreMenuDay,
} from './menu-day.suite';

const recipeOf = (mealType: string, i: number): string =>
  MENU_PLAN_RECIPES.filter((recipe) => recipe.mealType === mealType)[i].name;

/** Every combination of one candidate of each list, the first ones first. */
function* combinations<T>(lists: T[][]): Generator<T[]> {
  if (lists.length === 0) {
    yield [];
    return;
  }
  for (const first of lists[0]) {
    for (const rest of combinations(lists.slice(1))) {
      yield [first, ...rest];
    }
  }
}

/** Whether the recipe of the name has one of the foods, in its name or its ingredients. */
const hasFood = (name: string, foods: string[]): boolean => {
  const recipe = MENU_PLAN_RECIPES.find((candidate) => candidate.name === name)!;
  const texts = [
    recipe.name,
    ...recipe.ingredients.flatMap(({ foodName, foodNameEn }) => [foodName, foodNameEn ?? '']),
  ].map((text) => text.toLowerCase());
  return foods.some((food) => texts.some((text) => text.includes(food.toLowerCase())));
};

/**
 * A whole menu of `days` days that has no problems, by the candidates of every meal in turn from
 * the first offset that has none, or the first one.
 */
function wholeMenuOracle<T>(
  days: number,
  candidates: MenuPlanCandidates,
  problemsOf: (plan: T) => string[],
): unknown {
  const planAt = (offset: number): unknown => ({
    message: 'New.',
    days: Array.from({ length: days }, (_, dayIndex) => ({
      dayIndex,
      meals: Object.fromEntries(
        MENU_PLAN_MEAL_TYPES.map((mealType) => {
          const options = candidates[mealType];
          return [mealType, options[(dayIndex + offset) % options.length].id];
        }),
      ),
    })),
  });
  const plans = Array.from({ length: 8 }, (_, offset) => planAt(offset));
  return plans.find((plan) => problemsOf(plan as T).length === 0) ?? plans[0];
}

/**
 * A model that answers every part with the first candidates that have no problems and no
 * `disliked` food where it can, as a model that follows the rules would: what a case can pass at
 * best.
 */
const oracleOf =
  (disliked: string[]) =>
  async <T>({ input }: ReplacementModelCall<T>, problemsOf: (plan: T) => string[]): Promise<T> => {
    const sent = JSON.parse(input[0].content as string);
    if (typeof sent.days === 'number') {
      return wholeMenuOracle(sent.days, sent.recipes, problemsOf) as T;
    }
    const named = (ids: string[], recipes: Array<{ id: string; name: string }>): string[] =>
      ids.map((id) => recipes.find((recipe) => recipe.id === id)!.name);
    const plans: Array<{ plan: unknown; names: string[] }> = Array.isArray(sent.recipes)
      ? (sent.recipes as Array<{ id: string; name: string }>).map(({ id, name }) => ({
          plan: { message: 'New.', recipe: id },
          names: [name],
        }))
      : [
          ...combinations(
            MENU_PLAN_MEAL_TYPES.map((mealType) =>
              (sent.recipes as MenuPlanCandidates)[mealType].map(({ id }) => id),
            ),
          ),
        ].map((ids) => ({
          plan: {
            message: 'New.',
            meals: Object.fromEntries(
              MENU_PLAN_MEAL_TYPES.map((mealType, i) => [mealType, ids[i]]),
            ),
          },
          names: named(
            ids,
            MENU_PLAN_MEAL_TYPES.flatMap(
              (mealType) => (sent.recipes as MenuPlanCandidates)[mealType],
            ),
          ),
        }));
    const valid = plans.filter(({ plan }) => problemsOf(plan as T).length === 0);
    const best =
      valid.find(({ names }) => !names.some((name) => hasFood(name, disliked))) ??
      valid[0] ??
      plans[0];
    return best.plan as T;
  };
const oracle = oracleOf([]);

/** The output of the case with every part answered by the oracle. */
const bestOutput = async (testCase: MenuDayCase): Promise<MenuDayOutput> => {
  const ask = oracleOf(caseProfile(testCase).rules.dislikedFoods);
  const replacement = caseReplacement(testCase);
  if (!replacement) {
    return planWholeMenu(testCase, ask);
  }
  const replaced = await replaceParts(replacement, replacementInput(testCase), ask);
  return { message: replaced.messages.join(' '), days: replaced.days, unknown: replaced.unknown };
};

const passed = (testCase: MenuDayCase, output: MenuDayOutput | null): Record<string, boolean> =>
  Object.fromEntries(scoreMenuDay(testCase, output).map(({ field, pass }) => [field, pass]));

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
    request: 'Plan a 3-day menu with day 2 planned again and another dinner on day 3.',
    previous: [day(0), day(1), day(2)],
    targets: [
      { dayIndex: 1, mealType: null },
      { dayIndex: 2, mealType: MealType.Dinner },
    ],
    expected: { days: 1, meals: 1 },
    rotation: 0,
  };
  let good: MenuDayOutput;

  beforeAll(async () => {
    good = await bestOutput(theCase);
  });

  describe('caseReplacement', () => {
    it('is what the app replaces for the targets of the case', () => {
      expect(caseReplacement(theCase)).toEqual({
        days: [1],
        meals: [{ dayIndex: 2, mealType: MealType.Dinner }],
      });
      expect(
        caseReplacement({
          ...theCase,
          targets: MENU_PLAN_MEAL_TYPES.map((mealType) => ({ dayIndex: 0, mealType })),
        }),
      ).toEqual({ days: [0], meals: [] });
      expect(
        caseReplacement({
          ...theCase,
          targets: [0, 1, 2].map((dayIndex) => ({ dayIndex, mealType: null })),
        }),
      ).toBeNull();
    });
  });

  describe('scoreMenuDay', () => {
    it('passes the best output of the case on every field', () => {
      expect(passed(theCase, good)).toEqual({
        replacement: true,
        candidates: true,
        unchanged: true,
        exclusions: true,
        validation: true,
        calories: true,
        disliked: true,
      });
    });

    it('fails a case that expects another replacement', () => {
      expect(passed({ ...theCase, expected: { days: 2, meals: 0 } }, good).replacement).toBe(false);
    });

    it('fails a part that is not a candidate, and every field it leaves unscored', () => {
      expect(passed(theCase, { message: 'x', days: null, unknown: ['l99 is not an id'] })).toEqual({
        replacement: true,
        candidates: false,
        unchanged: false,
        exclusions: false,
        validation: false,
        calories: false,
        disliked: false,
      });
    });

    it('fails a change outside the parts replaced', () => {
      const days = structuredClone(good.days)!;
      days[0].meals[1].servings += 0.25;
      days[2].meals[0].servings += 0.25;

      expect(
        scoreMenuDay(theCase, { ...good, days }).find(({ field }) => field === 'unchanged'),
      ).toMatchObject({ pass: false, actual: ['day 1 lunch', 'day 3 breakfast'] });
    });

    it('fails a new recipe the menu serves on another day while its meal had another', () => {
      const days = structuredClone(good.days)!;
      days[1].meals[0] = { ...days[0].meals[0] };

      expect(passed(theCase, { ...good, days }).exclusions).toBe(false);
    });

    it('lets a recipe of another day pass when the only other one is a meal the request replaced', () => {
      const vegan = loadCases(menuDaySuite.casesFile, menuDaySuite.caseSchema).find(
        ({ id }) => id === 'multi-mixed-7-vegan',
      )!;
      const previous = previousDays(vegan);
      const days = structuredClone(previous);
      // Saturday gets Tuesday's breakfast while only Monday's old one, replaced, is left over.
      days[5].meals[0] = { ...previous[1].meals[0] };
      const freed = previous[0].meals[0];
      const unused = allowedRecipes(MENU_PLAN_PROFILES.vegan).filter(
        ({ id, mealType }) =>
          mealType === MealType.Breakfast &&
          id !== freed.recipeId &&
          !days.some(({ meals }) => meals.some((meal) => meal.recipeId === id)),
      );
      days[0].meals[0] = {
        ...freed,
        recipeId: unused[0]?.id ?? 'new',
        recipe: { ...freed.recipe },
      };

      const exclusions = scoreMenuDay(vegan, { message: '', days, unknown: [] }).find(
        ({ field }) => field === 'exclusions',
      );

      expect(unused.length).toBeLessThanOrEqual(1);
      expect(exclusions?.actual).not.toContainEqual(expect.stringContaining('day 6 breakfast'));
    });

    it('fails a new day with a recipe the day had while its meal had another', () => {
      const days = structuredClone(good.days)!;
      days[1].meals[0] = { ...previousDays(theCase)[1].meals[0] };

      expect(passed(theCase, { ...good, days }).exclusions).toBe(false);
    });

    it('fails a new meal that is the old one', () => {
      const days = structuredClone(good.days)!;
      days[2].meals[3] = { ...previousDays(theCase)[2].meals[3] };

      expect(passed(theCase, { ...good, days }).exclusions).toBe(false);
    });

    it('fails every field on output that did not match the schema', () => {
      expect(scoreMenuDay(theCase, null).every(({ pass }) => !pass)).toBe(true);
    });
  });

  describe('run', () => {
    const usage: ModelUsage = { inputTokens: 1000, cachedInputTokens: 100, outputTokens: 50 };
    const result = (output: unknown): ModelResult<unknown> => ({
      output,
      modelId: 'm',
      latencyMs: 10,
      usage,
    });
    const goodDay = (): { message: string; meals: Record<string, string> } => ({
      message: 'New day.',
      meals: Object.fromEntries(
        MENU_PLAN_MEAL_TYPES.map((mealType) => [
          mealType,
          (oracleCalls[0].candidates as MenuPlanCandidates)[mealType][0].id,
        ]),
      ),
    });
    let openAi: jest.Mocked<OpenAiService>;
    let oracleCalls: Array<{ candidates: unknown }>;

    beforeEach(async () => {
      openAi = createMock<OpenAiService>();
      oracleCalls = [];
      await replaceParts(caseReplacement(theCase)!, replacementInput(theCase), async (call, p) => {
        oracleCalls.push({ candidates: JSON.parse(call.input[0].content as string).recipes });
        return oracle(call, p);
      });
    });

    it('runs the day call, then the meal call of the app, each with the candidates of the menu before it', async () => {
      const dinner = good.days![2].meals[3];
      const dinnerId = (oracleCalls[1].candidates as Array<{ id: string; name: string }>).find(
        ({ name }) => name === dinner.recipe.name,
      )!.id;
      const dayIds = Object.fromEntries(
        MENU_PLAN_MEAL_TYPES.map((mealType, i) => [
          mealType,
          (oracleCalls[0].candidates as MenuPlanCandidates)[mealType].find(
            ({ name }) => name === good.days![1].meals[i].recipe.name,
          )!.id,
        ]),
      );
      openAi.generateStructuredResult
        .mockResolvedValueOnce(result({ message: 'New day.', meals: dayIds }) as never)
        .mockResolvedValueOnce(result({ message: 'New dinner.', recipe: dinnerId }) as never);

      await expect(menuDaySuite.run(theCase, openAi)).resolves.toEqual({
        output: { message: 'New day. New dinner.', days: good.days, unknown: [] },
        modelId: 'm',
        latencyMs: 20,
        usage: { inputTokens: 2000, cachedInputTokens: 200, outputTokens: 100 },
        metrics: { repairs: 0 },
      });
      const [[dayInput, daySchema, dayOptions], [mealInput, mealSchema, mealOptions]] =
        openAi.generateStructuredResult.mock.calls;
      expect(daySchema).toBe(MenuDayPlanSchema);
      expect(dayOptions.maxOutputTokens).toBe(MENU_DAY_MAX_OUTPUT_TOKENS);
      expect(JSON.parse((dayInput as Array<{ content: string }>)[0].content)).toMatchObject({
        request: theCase.request,
        dayIndex: 1,
        recipes: oracleCalls[0].candidates,
      });
      expect(mealSchema).toBe(MenuMealPlanSchema);
      expect(mealOptions.maxOutputTokens).toBe(MENU_MEAL_MAX_OUTPUT_TOKENS);
      expect(JSON.parse((mealInput as Array<{ content: string }>)[0].content)).toMatchObject({
        dayIndex: 2,
        mealType: MealType.Dinner,
        recipes: oracleCalls[1].candidates,
      });
    });

    it('sends a part with problems back and counts the repairs of every part', async () => {
      openAi.generateStructuredResult
        .mockResolvedValueOnce(
          result({ message: 'x', meals: { ...goodDay().meals, lunch: 'x' } }) as never,
        )
        .mockResolvedValueOnce(result(goodDay()) as never)
        .mockResolvedValueOnce(result({ message: 'x', recipe: 'd99' }) as never)
        .mockResolvedValue(result({ message: 'x', recipe: 'd98' }) as never);

      const run = await menuDaySuite.run(theCase, openAi);

      expect(run).toMatchObject({
        output: {
          days: null,
          unknown: ['dayIndex 2, dinner: "d98" is not an id from the dinner recipes.'],
        },
        latencyMs: 10 * (2 + MENU_PLAN_MAX_ATTEMPTS),
        metrics: { repairs: 1 + MENU_PLAN_MAX_ATTEMPTS - 1 },
      });
      const [, [messages]] = openAi.generateStructuredResult.mock.calls;
      expect((messages as Array<{ content: string }>).at(-1)?.content).toBe(
        menuDayRetryMessage(['dayIndex 1, lunch: "x" is not an id from the lunch recipes.']),
      );
    });

    it('fails invalid output with the usage of every call', async () => {
      openAi.generateStructuredResult
        .mockResolvedValueOnce(result(goodDay()) as never)
        .mockRejectedValueOnce(new AssistantInvalidOutputException({ modelId: 'm', usage }));

      const error = await menuDaySuite.run(theCase, openAi).catch((e: unknown) => e);

      expect((error as AssistantInvalidOutputException).call).toEqual({
        modelId: 'm',
        usage: { inputTokens: 2000, cachedInputTokens: 200, outputTokens: 100 },
      });
    });

    it('plans a case of every day as the whole menu, with the dates of the previous one', async () => {
      const whole = {
        ...theCase,
        targets: [0, 1, 2].map((dayIndex) => ({ dayIndex, mealType: null })),
        expected: { days: 3, meals: 0 },
      };
      const best = await bestOutput(whole);
      openAi.generateStructuredResult.mockImplementation(async (messages, schema, options) => {
        expect(schema).toBe(MenuPlanSchema);
        expect(options).toMatchObject({ prompt: MENU_PLAN_PROMPT });
        expect(JSON.parse((messages as Array<{ content: string }>)[0].content).days).toBe(3);
        return result(
          wholeMenuOracle(
            3,
            JSON.parse((messages as Array<{ content: string }>)[0].content).recipes,
            () => [],
          ),
        );
      });

      const run = await menuDaySuite.run(whole, openAi);

      expect(openAi.generateStructuredResult).toHaveBeenCalledTimes(1);
      expect(run.output.days).toHaveLength(3);
      expect(run.output.unknown).toEqual([]);
      expect(passed(whole, best)).toEqual({
        replacement: true,
        candidates: true,
        unchanged: true,
        validation: true,
        calories: true,
        disliked: true,
      });
    });
  });

  it.each([
    ['a day outside the menu', { targets: [{ dayIndex: 3 }] }],
    ['no targets', { targets: [] }],
    ['a menu of one day', { previous: [day(0)], targets: [{ dayIndex: 0 }] }],
    ['an unknown recipe', { previous: [day(0), { ...day(1), lunch: 'Nope' }] }],
  ])('rejects a case with %s', (_case, overrides) => {
    expect(MenuDayCaseSchema.safeParse({ ...theCase, ...overrides }).success).toBe(false);
  });

  describe('cases.jsonl', () => {
    const cases = loadCases(menuDaySuite.casesFile, menuDaySuite.caseSchema);
    const replacements = cases.map(caseReplacement);

    it('redoes the first, a middle and the last day, every meal of a day, and several parts', () => {
      for (const tag of ['first', 'middle', 'last', 'days', 'meals', 'mixed', 'same-day']) {
        expect(cases.some((c) => c.tags.includes(tag))).toBe(true);
      }
      for (const mealType of MENU_PLAN_MEAL_TYPES) {
        expect(replacements.some((r) => r?.meals.some((meal) => meal.mealType === mealType))).toBe(
          true,
        );
      }
      expect(replacements.some((r) => r && r.days.length > 1)).toBe(true);
      expect(replacements.some((r) => r && r.meals.length > 1)).toBe(true);
      expect(replacements.some((r) => r && r.days.length > 0 && r.meals.length > 0)).toBe(true);
    });

    it('turns every meal of a day, and a day with a meal of it, into the day', () => {
      const collapsed = cases.filter(({ tags }) => tags.includes('collapse'));
      expect(collapsed.length).toBeGreaterThan(1);
      for (const c of collapsed) {
        expect(caseReplacement(c)).toMatchObject({ meals: [] });
      }
    });

    it('covers a week and every profile', () => {
      expect(cases.some((c) => c.previous.length === MENU_MAX_DAYS)).toBe(true);
      for (const profile of ['basic', 'vegan', 'vegetarian', 'allergy', 'low_kcal']) {
        expect(cases.some((c) => c.profile === profile)).toBe(true);
      }
    });

    it('replaces only some parts in every case but the whole menu ones, as many as it expects', () => {
      cases.forEach((c, i) => {
        expect([c.id, replacements[i] === null]).toEqual([c.id, c.tags.includes('full')]);
        if (c.expected) {
          expect({
            days: replacements[i]?.days.length ?? c.previous.length,
            meals: replacements[i]?.meals.length ?? 0,
          }).toEqual(c.expected);
        }
      });
    });

    it('has a constraint the request adds to a part, to a whole menu, and one that widens to it', () => {
      const constrained = cases.filter(({ rules }) => rules);
      expect(constrained.some((c) => caseReplacement(c) !== null)).toBe(true);
      expect(constrained.some((c) => c.tags.includes('full'))).toBe(true);
      expect(
        constrained.some((c) => c.tags.includes('full') && c.targets.length < c.previous.length),
      ).toBe(true);
    });

    it('can pass every case', async () => {
      for (const c of cases) {
        const failed = Object.entries(passed(c, await bestOutput(c)))
          .filter(([, pass]) => !pass)
          .map(([field]) => field);
        expect([c.id, failed]).toEqual([c.id, []]);
      }
    }, 60_000);
  });
});
