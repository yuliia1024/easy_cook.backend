import {
  MealType,
  MenuTargetField,
  MenuTargetScope,
  menuTargetDayReply,
  menuTargetMissingDayReply,
  menuTargetMissingMealReply,
} from '../../../common/constants';
import { MenuTarget } from '../../../common/contracts';
import { ResolvedDay } from '../../../common/types';
import { targetClarification, targetDayIndex } from './menu-target';

const MEALS = [MealType.Breakfast, MealType.Lunch, MealType.Dinner];
const menuOf = (days: number): ResolvedDay[] =>
  Array.from({ length: days }, (_, dayIndex) => ({
    dayIndex,
    date: null,
    meals: MEALS.map((mealType) => ({ mealType }) as ResolvedDay['meals'][number]),
  }));
const meal = (dayIndex: number | null, mealType = MealType.Dinner): MenuTarget => ({
  scope: MenuTargetScope.Meal,
  dayIndex,
  mealType,
});

describe('targetDayIndex', () => {
  it('is the day the target names', () => {
    expect(targetDayIndex(meal(2), menuOf(3))).toBe(2);
  });

  it('is the only day of a one-day menu when the target names none', () => {
    expect(targetDayIndex(meal(null), menuOf(1))).toBe(0);
  });

  it('is null when the target names no day of a menu of more days', () => {
    expect(targetDayIndex(meal(null), menuOf(3))).toBeNull();
  });
});

describe('targetClarification', () => {
  it.each<[string, MenuTarget, number]>([
    ['the whole menu', { scope: MenuTargetScope.Menu, dayIndex: null, mealType: null }, 3],
    [
      'a meal on every day',
      { scope: MenuTargetScope.Menu, dayIndex: null, mealType: MealType.Dinner },
      3,
    ],
    ['a day of the menu', { scope: MenuTargetScope.Day, dayIndex: 2, mealType: null }, 3],
    ['a meal of a day of the menu', meal(2), 3],
    ['a meal of a one-day menu without a day', meal(null), 1],
  ])('asks nothing about %s', (_case, target, days) => {
    expect(targetClarification(target, menuOf(days))).toBeNull();
  });

  it('asks which day a meal is on when the menu has more days', () => {
    expect(targetClarification(meal(null), menuOf(3))).toEqual({
      message: menuTargetDayReply(MealType.Dinner, 3),
      missingFields: [MenuTargetField.DayIndex],
    });
  });

  it.each([
    ['a day', { scope: MenuTargetScope.Day, dayIndex: 3, mealType: null }],
    ['a meal', meal(3)],
  ])('asks again for %s of a day the menu does not have', (_case, target) => {
    expect(targetClarification(target, menuOf(3))).toEqual({
      message: menuTargetMissingDayReply(3),
      missingFields: [MenuTargetField.DayIndex],
    });
  });

  it('asks again for a meal the day does not have', () => {
    expect(targetClarification(meal(1, MealType.Snack), menuOf(3))).toEqual({
      message: menuTargetMissingMealReply(MealType.Snack, MEALS),
      missingFields: [MenuTargetField.MealType],
    });
  });
});
