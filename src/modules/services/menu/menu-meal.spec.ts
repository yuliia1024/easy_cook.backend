import {
  MENU_MEAL_MAX_OUTPUT_TOKENS,
  MENU_MEAL_PROMPT,
  MealType,
  MenuIssueCode,
  MenuIssueSeverity,
} from '../../../common/constants';
import { MenuMealPlan, MenuMealPlanSchema } from '../../../common/contracts';
import { MenuComposition, MenuIssue, ProfileContext, ResolvedDay } from '../../../common/types';
import { buildRecipeSnapshot, PROFILE_ID } from '../../../test/fixtures';
import { toModelProfile } from '../profile-context/model-profile';
import {
  fitsDayKcal,
  fittingDayKcal,
  mealCandidateProblems,
  mealRecipes,
  mealServings,
  menuMealErrors,
  menuMealModelCall,
  menuRecipeIds,
  otherMealsKcal,
  replaceMeal,
} from './menu-meal';
import { MenuPlanCandidate } from './menu-plan';

/** A day of the meals, each one serving of a recipe of `kcal` per serving. */
const day = (dayIndex: number, meals: Array<[MealType, string | null, number]>): ResolvedDay => ({
  dayIndex,
  date: null,
  meals: meals.map(([mealType, recipeId, kcal]) => ({
    mealType,
    servings: 1,
    recipeId,
    recipe: buildRecipeSnapshot({
      id: recipeId ?? 'deleted',
      name: recipeId ?? 'deleted',
      mealType,
      perServing: { kcal, proteinG: 0, fatG: 0, carbsG: 0 },
    }),
  })),
});

const candidates: MenuPlanCandidate[] = [
  { id: 'd1', name: 'D', perServing: { kcal: 1, proteinG: 0, fatG: 0, carbsG: 0 }, complete: true },
];

describe('menuRecipeIds', () => {
  it('collects the recipes of every meal of the menu, without deleted ones', () => {
    const days = [
      day(0, [
        [MealType.Lunch, 'a', 0],
        [MealType.Dinner, null, 0],
      ]),
      day(1, [[MealType.Lunch, 'b', 0]]),
    ];

    expect(menuRecipeIds(days)).toEqual(new Set(['a', 'b']));
  });
});

describe('otherMealsKcal', () => {
  it('adds up the kcal of the other meals by their servings', () => {
    const lunchAndDinner = day(0, [
      [MealType.Lunch, 'a', 300],
      [MealType.Dinner, 'b', 500],
    ]);
    lunchAndDinner.meals[0].servings = 1.5;

    expect(otherMealsKcal(lunchAndDinner, MealType.Dinner)).toBe(450);
  });
});

describe('mealServings', () => {
  it('picks the servings that bring the day closest to the daily kcal', () => {
    expect(mealServings(200, 1700, 2000)).toBe(1.5);
    expect(mealServings(200, 1600, 1900)).toBe(1.5);
  });

  it('stays within the servings a meal can have', () => {
    expect(mealServings(100, 0, 2000)).toBe(2);
    expect(mealServings(1000, 2000, 2000)).toBe(0.5);
  });

  it('picks the servings nearest to one of equally close ones', () => {
    expect(mealServings(0, 1000, 2000)).toBe(1);
  });
});

describe('fitsDayKcal', () => {
  it('tells whether the best servings keep the day within the tolerance', () => {
    expect(fitsDayKcal(200, 1500, 2000)).toBe(true);
    expect(fitsDayKcal(2000, 1500, 2000)).toBe(false);
    expect(fitsDayKcal(100, 500, 2000)).toBe(false);
  });
});

describe('mealRecipes', () => {
  const recipe = (id: string, mealType = MealType.Dinner): { id: string; mealType: string } => ({
    id,
    mealType,
  });
  const menu = [
    day(0, [
      [MealType.Lunch, 'l1', 0],
      [MealType.Dinner, 'd1', 0],
    ]),
    day(1, [
      [MealType.Lunch, 'l1', 0],
      [MealType.Dinner, 'd2', 0],
    ]),
  ];

  it('keeps the recipes of the meal the menu does not serve yet', () => {
    expect(
      mealRecipes(
        [recipe('d1'), recipe('d2'), recipe('d3'), recipe('l2', MealType.Lunch)],
        menu,
        menu[1],
        MealType.Dinner,
      ).map(({ id }) => id),
    ).toEqual(['d3']);
  });

  it('keeps a recipe of another day rather than none, but not the old one', () => {
    expect(
      mealRecipes([recipe('d1'), recipe('d2')], menu, menu[1], MealType.Dinner).map(({ id }) => id),
    ).toEqual(['d1']);
  });

  it('keeps the old recipe when it is the only one', () => {
    expect(mealRecipes([recipe('d2')], menu, menu[1], MealType.Dinner).map(({ id }) => id)).toEqual(
      ['d2'],
    );
  });
});

describe('fittingDayKcal', () => {
  const kcalOf = (kcal: number): number => kcal;

  it('keeps the recipes that can keep the day within the tolerance', () => {
    expect(fittingDayKcal([200, 2000], kcalOf, 1500, 2000)).toEqual([200]);
  });

  it('keeps every recipe when none can or without daily calories', () => {
    expect(fittingDayKcal([2000, 3000], kcalOf, 1500, 2000)).toEqual([2000, 3000]);
    expect(fittingDayKcal([200, 2000], kcalOf, 1500, null)).toEqual([200, 2000]);
  });
});

describe('replaceMeal', () => {
  it('puts the meal in place of the one of its type and keeps the others as they are', () => {
    const before = day(0, [
      [MealType.Lunch, 'a', 0],
      [MealType.Dinner, 'b', 0],
    ]);
    const [, newDinner] = day(0, [
      [MealType.Lunch, 'a', 0],
      [MealType.Dinner, 'x', 0],
    ]).meals;

    const after = replaceMeal(before, newDinner);

    expect(after.meals.map(({ recipeId }) => recipeId)).toEqual(['a', 'x']);
    expect(after.meals[0]).toBe(before.meals[0]);
    expect(before.meals[1].recipeId).toBe('b');
  });
});

describe('menuMealModelCall', () => {
  it('sends the request, the meal, the other meals of the day, the profile and the candidates', () => {
    const profile: ProfileContext = {
      profileId: PROFILE_ID,
      goal: null,
      nutritionGoal: null,
      rules: { diets: [], allergies: [], excludedIngredients: [], dislikedFoods: [] },
    };
    const abortSignal = new AbortController().signal;
    const wednesday = day(2, [
      [MealType.Lunch, 'Soup', 0],
      [MealType.Dinner, 'Stew', 0],
    ]);

    const call = menuMealModelCall(
      'Another dinner',
      wednesday,
      MealType.Dinner,
      profile,
      candidates,
      abortSignal,
    );

    expect(call.input).toEqual([
      {
        role: 'user',
        content: JSON.stringify({
          request: 'Another dinner',
          dayIndex: 2,
          mealType: MealType.Dinner,
          day: [{ mealType: MealType.Lunch, name: 'Soup' }],
          profile: toModelProfile(profile),
          recipes: candidates,
        }),
      },
    ]);
    expect(call.schema).toBe(MenuMealPlanSchema);
    expect(call.options).toEqual({
      prompt: MENU_MEAL_PROMPT,
      maxOutputTokens: MENU_MEAL_MAX_OUTPUT_TOKENS,
      abortSignal,
    });
  });
});

describe('mealCandidateProblems', () => {
  it('names a recipe that is not a candidate, nothing for a candidate', () => {
    expect(
      mealCandidateProblems({ message: '', recipe: 'd9' }, candidates, 2, MealType.Dinner),
    ).toEqual(['dayIndex 2, dinner: "d9" is not an id from the dinner recipes.']);
    expect(
      mealCandidateProblems({ message: '', recipe: 'd1' }, candidates, 2, MealType.Dinner),
    ).toEqual([]);
  });
});

describe('menuMealErrors', () => {
  const plan: MenuMealPlan = { message: 'New dinner.', recipe: 'd1' };
  const error = (dayIndex?: number, position?: number): MenuIssue => ({
    severity: MenuIssueSeverity.Error,
    code: MenuIssueCode.ExcludedIngredient,
    message: `Error on ${dayIndex ?? 'the menu'}/${position ?? 'the day'}`,
    ...(dayIndex !== undefined && { dayIndex }),
    ...(position !== undefined && { position }),
  });
  const menuWith = (issues: MenuIssue[]): MenuComposition => ({
    days: [],
    dailyAverage: { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
    issues,
  });

  it('names a recipe that is not a candidate, before composing', () => {
    const compose = jest.fn();

    expect(
      menuMealErrors({ ...plan, recipe: 'd9' }, candidates, 2, MealType.Dinner, 3, compose),
    ).toEqual(['dayIndex 2, dinner: "d9" is not an id from the dinner recipes.']);
    expect(compose).not.toHaveBeenCalled();
  });

  it('returns the errors of the whole menu on the new meal, its day and the menu only', () => {
    const compose = jest
      .fn()
      .mockReturnValue(
        menuWith([
          error(2, 0),
          error(2, 3),
          error(1, 3),
          error(2),
          error(),
          { ...error(2, 3), severity: MenuIssueSeverity.Warning, message: 'Warning' },
        ]),
      );

    expect(menuMealErrors(plan, candidates, 2, MealType.Dinner, 3, compose)).toEqual([
      'Error on 2/3.',
      'Error on 2/the day.',
      'Error on the menu/the day.',
    ]);
    expect(compose).toHaveBeenCalledWith('d1');
  });
});
