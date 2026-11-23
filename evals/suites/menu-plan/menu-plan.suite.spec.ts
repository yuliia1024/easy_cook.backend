import {
  MealType,
  MENU_MAX_DAYS,
  MENU_MIN_DAYS,
  MENU_PLAN_MAX_ATTEMPTS,
  MENU_PLAN_MEAL_TYPES,
  menuPlanMaxOutputTokens,
  menuPlanRetryMessage,
} from '../../../src/common/constants';
import { MenuPlan, MenuPlanSchema } from '../../../src/common/contracts';
import { AssistantInvalidOutputException } from '../../../src/common/exceptions';
import { mentions } from '../../../src/modules/services/menu/menu-rules';
import { ModelResult, LlmService } from '../../../src/providers/llm/llm.service';
import { createMock } from '../../../src/test/create-mock';
import {
  candidatesPerMeal,
  MenuPlanCandidates,
  MenuPlanMealType,
  planDays,
} from '../../../src/modules/services/menu/menu-plan';
import { loadCases } from '../../lib/cases';
import {
  caseCandidates,
  composeCase,
  isVaried,
  MENU_PLAN_PROFILES,
  MENU_PLAN_RECIPES,
  MenuPlanCase,
  MenuPlanCaseSchema,
  menuPlanSuite,
  scoreMenuPlan,
} from './menu-plan.suite';

describe('menu-plan suite', () => {
  const testCase = (days: number, overrides: Partial<MenuPlanCase> = {}): MenuPlanCase => ({
    id: 'c',
    tags: [],
    profile: 'basic',
    request: 'Plan a menu.',
    days,
    rotation: 0,
    ...overrides,
  });
  /** The candidate positions of each day: breakfast, lunch, dinner, and the snack (the dinner's). */
  const planOf = (candidates: MenuPlanCandidates, picks: number[][]): MenuPlan => ({
    message: '',
    days: picks.map(([b, l, d, s = d], dayIndex) => ({
      dayIndex,
      meals: {
        breakfast: candidates.breakfast[b].id,
        lunch: candidates.lunch[l].id,
        dinner: candidates.dinner[d].id,
        snack: candidates.snack[s].id,
      },
    })),
  });

  describe('caseCandidates', () => {
    it('offers the candidates the app offers for the days', () => {
      const candidates = caseCandidates(testCase(3));

      for (const mealType of MENU_PLAN_MEAL_TYPES) {
        expect(candidates[mealType]).toHaveLength(candidatesPerMeal(3));
      }
    });

    it('offers only recipes the diets of the profile allow', () => {
      const candidates = caseCandidates(testCase(7, { profile: 'vegetarian' }));
      const allowed = new Set(
        MENU_PLAN_RECIPES.filter(({ dietType }) =>
          dietType.some((tag) => tag === 'vegetarian' || tag === 'vegan'),
        ).map(({ name }) => name),
      );

      expect(
        MENU_PLAN_MEAL_TYPES.flatMap((mealType) => candidates[mealType]).every(({ name }) =>
          allowed.has(name),
        ),
      ).toBe(true);
    });

    it('offers no recipe with an ingredient the profile is allergic to', () => {
      const candidates = caseCandidates(testCase(7, { profile: 'allergy' }));
      const byName = new Map(MENU_PLAN_RECIPES.map((recipe) => [recipe.name, recipe]));
      const foods = MENU_PLAN_MEAL_TYPES.flatMap((mealType) => candidates[mealType]).flatMap(
        ({ name }) => byName.get(name)!.ingredients,
      );

      expect(foods.length).toBeGreaterThan(0);
      for (const allergy of MENU_PLAN_PROFILES.allergy.rules.allergies) {
        expect(
          foods.filter(
            ({ foodName, foodNameEn }) =>
              mentions(foodName, allergy) || (foodNameEn !== null && mentions(foodNameEn, allergy)),
          ),
        ).toEqual([]);
      }
    });

    it('offers them by short ids, like the app', () => {
      expect(caseCandidates(testCase(1)).dinner.map(({ id }) => id)).toEqual([
        'd1',
        'd2',
        'd3',
        'd4',
        'd5',
        'd6',
      ]);
    });

    it('offers other candidates for another rotation', () => {
      expect(caseCandidates(testCase(1, { rotation: 3 })).lunch).not.toEqual(
        caseCandidates(testCase(1)).lunch,
      );
    });
  });

  describe('composeCase', () => {
    it('composes the planned recipes, servings fitted to the goal, with their issues against the profile', () => {
      const theCase = testCase(1, { profile: 'low_kcal' });
      const candidates = caseCandidates(theCase);
      const salmon = candidates.lunch.findIndex(({ name }) => name === 'Salmon poke bowl');
      const menu = composeCase(theCase, planDays(planOf(candidates, [[0, salmon, 0]])));

      expect(menu.days[0].meals.map(({ recipeName }) => recipeName)).toEqual(
        MENU_PLAN_MEAL_TYPES.map(
          (mealType) => candidates[mealType][mealType === MealType.Lunch ? salmon : 0].name,
        ),
      );
      expect(Math.abs(menu.days[0].totals.kcal - 1400)).toBeLessThanOrEqual(70);
      expect(menu.issues.map(({ code }) => code)).toEqual(['disliked_food']);
    });
  });

  describe('scoreMenuPlan', () => {
    const fields = (scores: ReturnType<typeof scoreMenuPlan>): Array<[string, boolean]> =>
      scores.map(({ field, pass }) => [field, pass]);
    /** The position of the candidate of the meal with the fewest or the most kcal. */
    const extreme = (
      candidates: MenuPlanCandidates,
      mealType: MenuPlanMealType,
      pick: (a: number, b: number) => boolean,
    ): number =>
      candidates[mealType].reduce(
        (best, { perServing }, i) =>
          pick(perServing.kcal, candidates[mealType][best].perServing.kcal) ? i : best,
        0,
      );

    it('passes a plan of the requested days from the candidates, on target, varied, without disliked foods', () => {
      const theCase = testCase(3, { profile: 'low_kcal' });
      const candidates = caseCandidates(theCase);
      const salmon = candidates.lunch.findIndex(({ name }) => name === 'Salmon poke bowl');
      const lunches = [0, 1, 2, 3].filter((i) => i !== salmon);
      const plan = planOf(candidates, [
        [0, lunches[0], 0],
        [1, lunches[1], 1],
        [2, lunches[2], 2],
      ]);

      expect(fields(scoreMenuPlan(theCase, plan))).toEqual([
        ['days', true],
        ['candidates', true],
        ['validation', true],
        ['calories', true],
        ['disliked', true],
        ['variety', true],
      ]);
    });

    it('scores the calories of the days with the servings fitted to the goal', () => {
      const theCase = testCase(1);
      const candidates = caseCandidates(theCase);
      const lowest = (mealType: MenuPlanMealType): number =>
        extreme(candidates, mealType, (a, b) => a < b);
      const plan = planOf(candidates, [
        [
          lowest(MealType.Breakfast),
          lowest(MealType.Lunch),
          lowest(MealType.Dinner),
          lowest(MealType.Snack),
        ],
      ]);

      const [kcal] = scoreMenuPlan(theCase, plan)[3].actual as number[];

      expect(scoreMenuPlan(theCase, plan)[3]).toMatchObject({
        field: 'calories',
        pass: true,
        expected: '2000 kcal ± 15 % a day',
      });
      expect(Math.abs(kcal - 2000)).toBeLessThanOrEqual(100);
    });

    it('fails a disliked food', () => {
      const theCase = testCase(1, { profile: 'low_kcal' });
      const candidates = caseCandidates(theCase);
      const salmon = candidates.lunch.findIndex(({ name }) => name === 'Salmon poke bowl');

      expect(scoreMenuPlan(theCase, planOf(candidates, [[0, salmon, 0]]))[4]).toMatchObject({
        field: 'disliked',
        pass: false,
        expected: ['salmon'],
        actual: [expect.stringContaining('Salmon poke bowl')],
      });
    });

    it('fails the validation, calories, disliked foods and variety of a plan with other days', () => {
      const candidates = caseCandidates(testCase(3));
      const plan = planOf(candidates, [
        [0, 0, 0],
        [1, 1, 1],
      ]);

      const scores = scoreMenuPlan(testCase(3), plan);

      expect(fields(scores)).toEqual([
        ['days', false],
        ['candidates', true],
        ['validation', false],
        ['calories', false],
        ['disliked', false],
        ['variety', false],
      ]);
      expect(scores[2].actual).toEqual([expect.stringContaining('Return exactly 3 days')]);
    });

    it('fails an id that is not a candidate of the meal', () => {
      const candidates = caseCandidates(testCase(1));
      const plan = planOf(candidates, [[0, 0, 0]]);
      plan.days[0].meals.lunch = candidates.breakfast[0].id;

      expect(scoreMenuPlan(testCase(1), plan)[1]).toMatchObject({
        field: 'candidates',
        pass: false,
        actual: [expect.stringContaining('lunch')],
      });
    });

    it('fails every field on output that did not match the schema', () => {
      expect(scoreMenuPlan(testCase(1), null).every(({ pass }) => !pass)).toBe(true);
    });
  });

  describe('isVaried', () => {
    const candidates = caseCandidates(testCase(3));

    it('fails a recipe on two days in a row', () => {
      expect(
        isVaried(
          planOf(candidates, [
            [0, 0, 0],
            [0, 1, 1],
            [1, 2, 2],
          ]),
          candidates,
        ),
      ).toBe(false);
    });

    it('fails a repeat while the meal has unused candidates', () => {
      expect(
        isVaried(
          planOf(candidates, [
            [0, 0, 0],
            [1, 1, 1],
            [0, 2, 2],
          ]),
          candidates,
        ),
      ).toBe(false);
    });

    it('allows a repeat, not in a row, once every candidate is used', () => {
      const two: MenuPlanCandidates = {
        breakfast: candidates.breakfast.slice(0, 2),
        lunch: candidates.lunch.slice(0, 2),
        dinner: candidates.dinner.slice(0, 2),
        snack: candidates.snack.slice(0, 2),
      };

      expect(
        isVaried(
          planOf(two, [
            [0, 0, 0],
            [1, 1, 1],
            [0, 0, 0],
          ]),
          two,
        ),
      ).toBe(true);
    });
  });

  describe('run', () => {
    const usage = { inputTokens: 1000, cachedInputTokens: 100, outputTokens: 50 };
    const theCase = testCase(1, { profile: 'vegetarian', rotation: 1 });
    const candidates = caseCandidates(theCase);
    const good = planOf(candidates, [[0, 0, 0]]);
    const wrong: MenuPlan = {
      ...good,
      days: [{ dayIndex: 0, meals: { ...good.days[0].meals, lunch: 'x' } }],
    };
    const result = (output: MenuPlan): ModelResult<MenuPlan> => ({
      output,
      modelId: 'm',
      latencyMs: 10,
      usage,
    });
    let llm: jest.Mocked<LlmService>;

    beforeEach(() => {
      llm = createMock<LlmService>();
    });

    it('runs the planner call of the app with the candidates of the case', async () => {
      llm.generateStructuredResult.mockResolvedValue(result(good) as never);

      await expect(menuPlanSuite.run(theCase, llm)).resolves.toEqual({
        ...result(good),
        metrics: { repairs: 0 },
      });

      const [[input, schema, options]] = llm.generateStructuredResult.mock.calls;
      expect(schema).toBe(MenuPlanSchema);
      expect(options.maxOutputTokens).toBe(menuPlanMaxOutputTokens(1));
      const sent = JSON.parse((input as Array<{ content: string }>)[0].content);
      expect(sent.days).toBe(1);
      expect(sent.recipes).toEqual(candidates);
    });

    it('sends a plan with problems back and counts the repairs, usage and latency of every call', async () => {
      llm.generateStructuredResult
        .mockResolvedValueOnce(result(wrong) as never)
        .mockResolvedValueOnce(result(good) as never);

      await expect(menuPlanSuite.run(theCase, llm)).resolves.toEqual({
        output: good,
        modelId: 'm',
        latencyMs: 20,
        usage: { inputTokens: 2000, cachedInputTokens: 200, outputTokens: 100 },
        metrics: { repairs: 1 },
      });
      const [, [messages]] = llm.generateStructuredResult.mock.calls;
      expect((messages as Array<{ content: string }>).at(-1)?.content).toBe(
        menuPlanRetryMessage(['dayIndex 0, lunch: "x" is not an id from the lunch recipes.']),
      );
    });

    it('returns the last plan after the last attempt', async () => {
      llm.generateStructuredResult.mockResolvedValue(result(wrong) as never);

      await expect(menuPlanSuite.run(theCase, llm)).resolves.toMatchObject({
        output: wrong,
        metrics: { repairs: MENU_PLAN_MAX_ATTEMPTS - 1 },
      });
    });

    it('fails invalid output with the usage of every call', async () => {
      llm.generateStructuredResult
        .mockResolvedValueOnce(result(wrong) as never)
        .mockRejectedValueOnce(new AssistantInvalidOutputException({ modelId: 'm', usage }));

      const error = await menuPlanSuite.run(theCase, llm).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AssistantInvalidOutputException);
      expect((error as AssistantInvalidOutputException).call).toEqual({
        modelId: 'm',
        usage: { inputTokens: 2000, cachedInputTokens: 200, outputTokens: 100 },
      });
    });
  });

  it('rejects a case outside the days a menu can have', () => {
    for (const days of [MENU_MIN_DAYS - 1, MENU_MAX_DAYS + 1]) {
      expect(MenuPlanCaseSchema.safeParse({ id: 'c', request: 'x', days }).success).toBe(false);
    }
  });

  describe('cases.jsonl', () => {
    const cases = loadCases(menuPlanSuite.casesFile, menuPlanSuite.caseSchema);

    it('covers every number of days a menu can have', () => {
      const days = new Set(cases.map((c) => c.days));
      for (let n = MENU_MIN_DAYS; n <= MENU_MAX_DAYS; n++) {
        expect(days.has(n)).toBe(true);
      }
    });

    it('tags every case with its days', () => {
      expect(cases.every((c) => c.tags.includes(`days-${c.days}`))).toBe(true);
    });

    it.each(['basic', 'vegan', 'allergy', 'low_kcal'])(
      'plans 1, 3 and 7 days for the %s profile',
      (profile) => {
        const tag = profile.replace('_', '-');
        const days = cases
          .filter((c) => c.profile === profile && c.tags.includes(tag))
          .map((c) => c.days);

        expect(days).toEqual(expect.arrayContaining([1, 3, 7]));
      },
    );
  });
});
