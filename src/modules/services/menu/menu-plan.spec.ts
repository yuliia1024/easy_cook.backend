import {
  MENU_PLAN_CANDIDATES_MAX,
  MENU_PLAN_INSTRUCTIONS,
  MealType,
  menuPlanMaxOutputTokens,
} from '../../../common/constants';
import { MenuPlan, MenuPlanSchema } from '../../../common/contracts';
import { ProfileContext } from '../../../common/types';
import { PROFILE_ID } from '../../../test/fixtures';
import { toModelProfile } from '../profile-context/model-profile';
import {
  candidatesPerMeal,
  labelCandidates,
  MenuPlanCandidate,
  MenuPlanCandidates,
  menuPlanModelCall,
  planDays,
  planProblems,
  selectCandidates,
} from './menu-plan';

const candidate = (id: string, kcal: number): MenuPlanCandidate => ({
  id,
  name: id,
  perServing: { kcal, proteinG: 0, fatG: 0, carbsG: 0 },
  complete: true,
});

describe('candidatesPerMeal', () => {
  it.each([
    [1, 6],
    [3, 8],
    [7, MENU_PLAN_CANDIDATES_MAX],
  ])('offers %i day(s) %i candidates', (days, count) => {
    expect(candidatesPerMeal(days)).toBe(count);
  });
});

describe('selectCandidates', () => {
  // A lunch is 35 % of the day: 700 kcal of 2000; l600 and l800 tie, in their order.
  const lunches = [100, 200, 400, 600, 700, 800, 900, 1000].map((kcal) =>
    candidate(`l${kcal}`, kcal),
  );
  const ids = (selected: MenuPlanCandidate[]): string[] => selected.map(({ id }) => id);

  it('takes the recipes closest to the calorie share of the meal', () => {
    expect(ids(selectCandidates(lunches, MealType.Lunch, 2000, 2, 0))).toEqual(['l700', 'l600']);
  });

  it('rotates within a pool of twice the count, wrapping around', () => {
    // Pool: l700, l600, l800, l900.
    expect(ids(selectCandidates(lunches, MealType.Lunch, 2000, 2, 1))).toEqual(['l600', 'l800']);
    expect(ids(selectCandidates(lunches, MealType.Lunch, 2000, 2, 3))).toEqual(['l900', 'l700']);
    expect(ids(selectCandidates(lunches, MealType.Lunch, 2000, 2, 5))).toEqual(['l600', 'l800']);
  });

  it('keeps the order of the recipes without a calorie target', () => {
    expect(ids(selectCandidates(lunches, MealType.Lunch, null, 2, 0))).toEqual(['l100', 'l200']);
  });

  it('offers every recipe when there are no more than the count', () => {
    expect(selectCandidates(lunches.slice(0, 3), MealType.Lunch, 2000, 5, 2)).toHaveLength(3);
  });
});

describe('labelCandidates', () => {
  it('gives every candidate a short id by meal and position and maps it to the recipe', () => {
    const { candidates, recipeIds } = labelCandidates({
      breakfast: [candidate('rec-b1', 400), candidate('rec-b2', 300)],
      lunch: [candidate('rec-l', 700)],
      dinner: [candidate('rec-d', 600)],
      snack: [candidate('rec-s', 150)],
    });

    expect(candidates).toEqual({
      breakfast: [
        { ...candidate('rec-b1', 400), id: 'b1' },
        { ...candidate('rec-b2', 300), id: 'b2' },
      ],
      lunch: [{ ...candidate('rec-l', 700), id: 'l1' }],
      dinner: [{ ...candidate('rec-d', 600), id: 'd1' }],
      snack: [{ ...candidate('rec-s', 150), id: 's1' }],
    });
    expect([...recipeIds]).toEqual([
      ['b1', 'rec-b1'],
      ['b2', 'rec-b2'],
      ['l1', 'rec-l'],
      ['s1', 'rec-s'],
      ['d1', 'rec-d'],
    ]);
  });
});

describe('menuPlanModelCall', () => {
  it('sends the request, the days, the profile and the candidates, with output for every day', () => {
    const profile: ProfileContext = {
      profileId: PROFILE_ID,
      goal: null,
      nutritionGoal: null,
      rules: { diets: [], allergies: [], excludedIngredients: [], dislikedFoods: [] },
    };
    const candidates: MenuPlanCandidates = {
      breakfast: [candidate('b', 400)],
      lunch: [candidate('l', 700)],
      dinner: [candidate('d', 600)],
      snack: [candidate('s', 150)],
    };
    const abort = new AbortController();

    expect(menuPlanModelCall('Two days', 2, profile, candidates, abort.signal)).toEqual({
      input: [
        {
          role: 'user',
          content: JSON.stringify({
            request: 'Two days',
            days: 2,
            profile: toModelProfile(profile),
            recipes: candidates,
          }),
        },
      ],
      schema: MenuPlanSchema,
      options: {
        instructions: MENU_PLAN_INSTRUCTIONS,
        maxOutputTokens: menuPlanMaxOutputTokens(2),
        abortSignal: abort.signal,
      },
    });
  });
});

describe('planProblems', () => {
  const candidates: MenuPlanCandidates = {
    breakfast: [candidate('b', 400)],
    lunch: [candidate('l', 700)],
    dinner: [candidate('d', 600)],
    snack: [candidate('s', 150)],
  };
  const meals = { breakfast: 'b', lunch: 'l', dinner: 'd', snack: 's' };
  const plan = (...days: MenuPlan['days']): MenuPlan => ({ message: '', days });

  it('finds none in a plan of the requested days from the candidates, in any order', () => {
    expect(
      planProblems(plan({ dayIndex: 1, meals }, { dayIndex: 0, meals }), candidates, 2),
    ).toEqual([]);
  });

  it.each([
    ['too few days', plan({ dayIndex: 0, meals }), '[0]'],
    ['a repeated dayIndex', plan({ dayIndex: 0, meals }, { dayIndex: 0, meals }), '[0,0]'],
    [
      'a dayIndex that does not start at 0',
      plan({ dayIndex: 1, meals }, { dayIndex: 2, meals }),
      '[1,2]',
    ],
  ])('names %s', (_case, wrong, returned) => {
    expect(planProblems(wrong, candidates, 2)).toEqual([
      `Return exactly 2 days with dayIndex 0 to 1, each once; you returned dayIndex ${returned}.`,
    ]);
  });

  it('names every meal that is not a candidate of that meal', () => {
    expect(
      planProblems(
        plan({ dayIndex: 0, meals: { breakfast: 'x', lunch: 'l', dinner: 'b', snack: 's' } }),
        candidates,
        1,
      ),
    ).toEqual([
      'dayIndex 0, breakfast: "x" is not an id from the breakfast recipes.',
      'dayIndex 0, dinner: "b" is not an id from the dinner recipes.',
    ]);
  });
});

describe('planDays', () => {
  it('orders the meals of the days by dayIndex', () => {
    const first = { breakfast: 'b1', lunch: 'l1', dinner: 'd1', snack: 's1' };
    const second = { breakfast: 'b2', lunch: 'l2', dinner: 'd2', snack: 's2' };

    expect(
      planDays({
        message: '',
        days: [
          { dayIndex: 1, meals: second },
          { dayIndex: 0, meals: first },
        ],
      }),
    ).toEqual([first, second]);
  });
});
