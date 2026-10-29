import {
  MENU_MAX_DAYS,
  MENU_MIN_DAYS,
  MENU_PLAN_MEAL_TYPES,
  menuPlanMaxOutputTokens,
} from '../../../src/common/constants';
import { MenuPlan, MenuPlanSchema } from '../../../src/common/contracts';
import { OpenAiService } from '../../../src/providers/open-ai/open-ai.service';
import { createMock } from '../../../src/test/create-mock';
import {
  candidatesPerMeal,
  MenuPlanCandidates,
} from '../../../src/modules/services/menu/menu-plan';
import { loadCases } from '../../lib/cases';
import {
  caseCandidates,
  isVaried,
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

  describe('scoreMenuPlan', () => {
    const candidates = caseCandidates(testCase(3));

    it('passes a plan of the requested days from the candidates without repeats', () => {
      const plan = planOf(candidates, [
        [0, 0, 0],
        [1, 1, 1],
        [2, 2, 2],
      ]);

      expect(scoreMenuPlan(testCase(3), plan).map(({ field, pass }) => [field, pass])).toEqual([
        ['days', true],
        ['candidates', true],
        ['variety', true],
      ]);
    });

    it('fails the days and the variety of a plan with other days', () => {
      const plan = planOf(candidates, [
        [0, 0, 0],
        [1, 1, 1],
      ]);

      expect(scoreMenuPlan(testCase(3), plan).map(({ field, pass }) => [field, pass])).toEqual([
        ['days', false],
        ['candidates', true],
        ['variety', false],
      ]);
    });

    it('fails an id that is not a candidate of the meal', () => {
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

  it('runs the planner call of the app with the candidates of the case', async () => {
    const openAi = createMock<OpenAiService>();
    const result = { output: null, modelId: 'm', latencyMs: 1, usage: null };
    openAi.generateStructuredResult.mockResolvedValue(result as never);
    const theCase = testCase(2, { profile: 'vegetarian', rotation: 1 });

    await expect(menuPlanSuite.run(theCase, openAi)).resolves.toBe(result);

    const [[input, schema, options]] = openAi.generateStructuredResult.mock.calls;
    expect(schema).toBe(MenuPlanSchema);
    expect(options.maxOutputTokens).toBe(menuPlanMaxOutputTokens(2));
    const sent = JSON.parse((input as Array<{ content: string }>)[0].content);
    expect(sent.days).toBe(2);
    expect(sent.recipes).toEqual(caseCandidates(theCase));
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
  });
});
