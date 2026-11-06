import {
  MENU_PLAN_MEAL_TYPES,
  MealType,
  MenuIssueCode,
  MenuIssueSeverity,
} from '../../../common/constants';
import { MenuIssue, ResolvedDay } from '../../../common/types';
import { buildRecipeSnapshot } from '../../../test/fixtures';
import { changedSlots, outsideScope, violatingSlots, widenReplacement } from './menu-diff';

/** A day of recipe `n` of every meal, one serving each. */
const day = (dayIndex: number, n: number): ResolvedDay => ({
  dayIndex,
  date: null,
  meals: MENU_PLAN_MEAL_TYPES.map((mealType) => {
    const recipe = buildRecipeSnapshot({ id: `${mealType}-${n}`, mealType });
    return { mealType, servings: 1, recipeId: recipe.id, recipe };
  }),
});
const menu = (): ResolvedDay[] => [day(0, 1), day(1, 2), day(2, 3)];
const everyMeal = (dayIndex: number): Array<{ dayIndex: number; mealType: MealType }> =>
  MENU_PLAN_MEAL_TYPES.map((mealType) => ({ dayIndex, mealType }));
const error = (dayIndex: number, position?: number): MenuIssue => ({
  severity: MenuIssueSeverity.Error,
  code: MenuIssueCode.DietViolation,
  message: 'Not vegan',
  dayIndex,
  position,
});

describe('changedSlots', () => {
  it('finds nothing in the same menu', () => {
    expect(changedSlots(menu(), menu())).toEqual([]);
  });

  it('finds a meal with another recipe, servings or snapshot', () => {
    const next = menu();
    next[0].meals[1] = day(0, 9).meals[1];
    next[1].meals[3].servings = 1.5;
    next[2].meals[0].recipe = { ...next[2].meals[0].recipe, name: 'Renamed' };

    expect(changedSlots(menu(), next)).toEqual([
      { dayIndex: 0, mealType: MealType.Lunch },
      { dayIndex: 1, mealType: MealType.Dinner },
      { dayIndex: 2, mealType: MealType.Breakfast },
    ]);
  });

  it('finds every meal of a day with another date or other meals', () => {
    const next = menu();
    next[0].date = new Date('2026-11-05');
    next[1].meals = next[1].meals.slice(0, 3);

    expect(changedSlots(menu(), next)).toEqual([...everyMeal(0), ...everyMeal(1)]);
  });

  it('finds every meal of a day only one of the menus has', () => {
    expect(changedSlots(menu(), menu().slice(0, 2))).toEqual(everyMeal(2));
    expect(changedSlots(menu().slice(0, 2), menu())).toEqual(everyMeal(2));
  });
});

describe('outsideScope', () => {
  it('keeps the changed meals the scope does not have', () => {
    expect(
      outsideScope(
        [
          { dayIndex: 0, mealType: MealType.Lunch },
          { dayIndex: 1, mealType: MealType.Lunch },
        ],
        everyMeal(0),
      ),
    ).toEqual([{ dayIndex: 1, mealType: MealType.Lunch }]);
  });
});

describe('violatingSlots', () => {
  it('lists the meals with an error, not the warnings nor the issues of a whole day', () => {
    expect(
      violatingSlots(
        [
          error(0, 1),
          { ...error(1, 0), severity: MenuIssueSeverity.Warning },
          error(2),
          error(2, 3),
          error(7, 0),
        ],
        menu(),
      ),
    ).toEqual([
      { dayIndex: 0, mealType: MealType.Lunch },
      { dayIndex: 2, mealType: MealType.Dinner },
    ]);
  });
});

describe('widenReplacement', () => {
  const replacement = { days: [1], meals: [{ dayIndex: 2, mealType: MealType.Dinner }] };

  it('keeps the replacement as it is without other meals', () => {
    expect(widenReplacement(replacement, [], menu())).toBe(replacement);
  });

  it('adds the meals, each once, a meal of a day replaced as part of it', () => {
    expect(
      widenReplacement(
        replacement,
        [
          { dayIndex: 0, mealType: MealType.Snack },
          { dayIndex: 1, mealType: MealType.Lunch },
          { dayIndex: 2, mealType: MealType.Dinner },
        ],
        menu(),
      ),
    ).toEqual({
      days: [1],
      meals: [
        { dayIndex: 0, mealType: MealType.Snack },
        { dayIndex: 2, mealType: MealType.Dinner },
      ],
    });
  });

  it('replaces a day whose every meal is added as the whole day', () => {
    expect(widenReplacement(replacement, everyMeal(0), menu())).toEqual({
      days: [0, 1],
      meals: [{ dayIndex: 2, mealType: MealType.Dinner }],
    });
  });

  it('plans the whole menu again when that is every day', () => {
    expect(widenReplacement(replacement, [...everyMeal(0), ...everyMeal(2)], menu())).toBeNull();
  });
});
