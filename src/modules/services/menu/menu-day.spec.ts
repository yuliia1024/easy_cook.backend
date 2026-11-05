import {
  MENU_DAY_MAX_OUTPUT_TOKENS,
  MENU_DAY_PROMPT,
  MealType,
  MenuIssueCode,
  MenuIssueSeverity,
} from '../../../common/constants';
import { MenuDayPlan, MenuDayPlanSchema } from '../../../common/contracts';
import { MenuComposition, MenuIssue, ProfileContext, ResolvedDay } from '../../../common/types';
import { buildRecipeSnapshot, PROFILE_ID } from '../../../test/fixtures';
import { toModelProfile } from '../profile-context/model-profile';
import {
  menuDayErrors,
  menuDayModelCall,
  otherDaysRecipeIds,
  replaceDay,
  withoutRecipes,
} from './menu-day';
import { MenuPlanCandidates } from './menu-plan';

const day = (dayIndex: number, recipeIds: Array<string | null>): ResolvedDay => ({
  dayIndex,
  date: null,
  meals: recipeIds.map((recipeId) => ({
    mealType: MealType.Lunch,
    servings: 1,
    recipeId,
    recipe: buildRecipeSnapshot({ id: recipeId ?? 'deleted' }),
  })),
});

const candidates: MenuPlanCandidates = {
  [MealType.Breakfast]: [
    {
      id: 'b1',
      name: 'B',
      perServing: { kcal: 1, proteinG: 0, fatG: 0, carbsG: 0 },
      complete: true,
    },
  ],
  [MealType.Lunch]: [
    {
      id: 'l1',
      name: 'L',
      perServing: { kcal: 1, proteinG: 0, fatG: 0, carbsG: 0 },
      complete: true,
    },
  ],
  [MealType.Snack]: [
    {
      id: 's1',
      name: 'S',
      perServing: { kcal: 1, proteinG: 0, fatG: 0, carbsG: 0 },
      complete: true,
    },
  ],
  [MealType.Dinner]: [
    {
      id: 'd1',
      name: 'D',
      perServing: { kcal: 1, proteinG: 0, fatG: 0, carbsG: 0 },
      complete: true,
    },
  ],
};

describe('otherDaysRecipeIds', () => {
  it('collects the recipes of every other day, without deleted ones', () => {
    const days = [day(0, ['a', 'b']), day(1, ['c', null]), day(2, ['a', 'd'])];

    expect(otherDaysRecipeIds(days, 1)).toEqual(new Set(['a', 'b', 'd']));
    expect(otherDaysRecipeIds(days, 0)).toEqual(new Set(['c', 'a', 'd']));
  });
});

describe('withoutRecipes', () => {
  const recipes = [
    { id: 'b1', mealType: MealType.Breakfast },
    { id: 'b2', mealType: MealType.Breakfast },
    { id: 'l1', mealType: MealType.Lunch },
    { id: 'd1', mealType: MealType.Dinner },
  ];

  it('leaves the excluded recipes out', () => {
    expect(withoutRecipes(recipes, new Set(['b1', 'x'])).map(({ id }) => id)).toEqual([
      'b2',
      'l1',
      'd1',
    ]);
  });

  it('keeps every recipe of a meal that would be left without any', () => {
    expect(withoutRecipes(recipes, new Set(['b1', 'l1'])).map(({ id }) => id)).toEqual([
      'b2',
      'l1',
      'd1',
    ]);
  });
});

describe('replaceDay', () => {
  it('puts the day in place of the one with its dayIndex and keeps the others as they are', () => {
    const days = [day(0, ['a']), day(1, ['b']), day(2, ['c'])];
    const replaced = replaceDay(days, day(1, ['x']));

    expect(replaced.map(({ meals }) => meals[0].recipeId)).toEqual(['a', 'x', 'c']);
    expect(replaced[0]).toBe(days[0]);
    expect(replaced[2]).toBe(days[2]);
    expect(days[1].meals[0].recipeId).toBe('b');
  });
});

describe('menuDayModelCall', () => {
  it('sends the request, the day, the profile and the candidates with the day prompt', () => {
    const profile: ProfileContext = {
      profileId: PROFILE_ID,
      goal: null,
      nutritionGoal: null,
      rules: { diets: [], allergies: [], excludedIngredients: [], dislikedFoods: [] },
    };
    const abortSignal = new AbortController().signal;

    const call = menuDayModelCall('Redo day 2', 1, profile, candidates, abortSignal);

    expect(call.input).toEqual([
      {
        role: 'user',
        content: JSON.stringify({
          request: 'Redo day 2',
          dayIndex: 1,
          profile: toModelProfile(profile),
          recipes: candidates,
        }),
      },
    ]);
    expect(call.schema).toBe(MenuDayPlanSchema);
    expect(call.options).toEqual({
      prompt: MENU_DAY_PROMPT,
      maxOutputTokens: MENU_DAY_MAX_OUTPUT_TOKENS,
      abortSignal,
    });
  });
});

describe('menuDayErrors', () => {
  const plan: MenuDayPlan = {
    message: 'New day.',
    meals: { breakfast: 'b1', lunch: 'l1', snack: 's1', dinner: 'd1' },
  };
  const error = (dayIndex?: number): MenuIssue => ({
    severity: MenuIssueSeverity.Error,
    code: MenuIssueCode.ExcludedIngredient,
    message: `Error on ${dayIndex ?? 'the menu'}`,
    ...(dayIndex !== undefined && { dayIndex }),
  });
  const menuWith = (issues: MenuIssue[]): MenuComposition => ({
    days: [],
    dailyAverage: { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
    issues,
  });

  it('names a meal that is not a candidate, before composing', () => {
    const compose = jest.fn();

    expect(
      menuDayErrors({ ...plan, meals: { ...plan.meals, lunch: 'l9' } }, candidates, 2, compose),
    ).toEqual(['dayIndex 2, lunch: "l9" is not an id from the lunch recipes.']);
    expect(compose).not.toHaveBeenCalled();
  });

  it('returns the errors of the whole menu on the planned day only', () => {
    const compose = jest
      .fn()
      .mockReturnValue(
        menuWith([
          error(0),
          error(2),
          error(),
          { ...error(2), severity: MenuIssueSeverity.Warning, message: 'Warning on 2' },
        ]),
      );

    expect(menuDayErrors(plan, candidates, 2, compose)).toEqual([
      'Error on 2.',
      'Error on the menu.',
    ]);
    expect(compose).toHaveBeenCalledWith(plan.meals);
  });

  it('has no errors when the day has none', () => {
    expect(menuDayErrors(plan, candidates, 1, () => menuWith([error(0)]))).toEqual([]);
  });
});
