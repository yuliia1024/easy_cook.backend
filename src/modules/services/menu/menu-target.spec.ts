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
import {
  MenuReplacement,
  readTargets,
  replacementClarification,
  resolveReplaceTarget,
  targetClarification,
  targetDayIndex,
} from './menu-target';

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
const day = (dayIndex: number): MenuTarget => ({
  scope: MenuTargetScope.Day,
  dayIndex,
  mealType: null,
});
const wholeMenu = (mealType: MealType | null = null): MenuTarget => ({
  scope: MenuTargetScope.Menu,
  dayIndex: null,
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

describe('replacementClarification', () => {
  it('asks about the first target the menu cannot pin down', () => {
    expect(replacementClarification([day(1), meal(null), meal(5)], menuOf(3))).toEqual({
      message: menuTargetDayReply(MealType.Dinner, 3),
      missingFields: [MenuTargetField.DayIndex],
    });
  });

  it('asks nothing when the menu pins down every target', () => {
    expect(replacementClarification([day(1), meal(2)], menuOf(3))).toBeNull();
  });

  it('asks nothing when a target changes the whole menu', () => {
    expect(replacementClarification([meal(null), wholeMenu()], menuOf(3))).toBeNull();
  });
});

describe('resolveReplaceTarget', () => {
  const everyMeal = (dayIndex: number): MenuTarget[] =>
    MEALS.map((mealType) => meal(dayIndex, mealType));
  const slot = (
    dayIndex: number,
    mealType = MealType.Dinner,
  ): MenuReplacement['meals'][number] => ({
    dayIndex,
    mealType,
  });

  it.each<[string, MenuTarget[], MenuReplacement | null]>([
    ['a day', [day(1)], { days: [1], meals: [] }],
    ['a meal', [meal(2)], { days: [], meals: [slot(2)] }],
    ['days in the order of the menu', [day(3), day(0)], { days: [0, 3], meals: [] }],
    [
      'meals of other days, in the order of the menu',
      [meal(4, MealType.Lunch), meal(2)],
      { days: [], meals: [slot(2), slot(4, MealType.Lunch)] },
    ],
    ['every meal of a day as one day', everyMeal(1), { days: [1], meals: [] }],
    [
      'every meal of two days as two days',
      [...everyMeal(1), ...everyMeal(2)],
      { days: [1, 2], meals: [] },
    ],
    [
      'some meals of a day as those meals',
      [meal(1, MealType.Breakfast), meal(1)],
      { days: [], meals: [slot(1, MealType.Breakfast), slot(1)] },
    ],
    ['a day with a meal of it as the day', [day(1), meal(1)], { days: [1], meals: [] }],
    ['a day and a meal of another day', [day(1), meal(4)], { days: [1], meals: [slot(4)] }],
    ['a day named twice once', [day(1), day(1)], { days: [1], meals: [] }],
    ['a meal named twice once', [meal(2), meal(2)], { days: [], meals: [slot(2)] }],
    ['every day as the whole menu', [0, 1, 2, 3, 4].map(day), null],
    [
      'every day by days and meals as the whole menu',
      [0, 1, 2, 3].map(day).concat(everyMeal(4)),
      null,
    ],
    ['a change to the whole menu as the whole menu', [day(1), wholeMenu()], null],
    ['a meal on every day as the whole menu', [wholeMenu(MealType.Dinner)], null],
    ['no target as the whole menu', [], null],
  ])('replaces %s', (_case, targets, expected) => {
    expect(resolveReplaceTarget(targets, menuOf(5))).toEqual(expected);
  });

  it('takes the meals of a day from the menu, not from every meal there is', () => {
    const menu = menuOf(3);
    menu[1].meals = menu[1].meals.filter(({ mealType }) => mealType !== MealType.Breakfast);

    expect(resolveReplaceTarget([meal(1, MealType.Lunch), meal(1)], menu)).toEqual({
      days: [1],
      meals: [],
    });
  });

  it('takes the only day of a one-day menu for a meal without a day', () => {
    expect(resolveReplaceTarget([meal(null)], menuOf(1))).toEqual({
      days: [],
      meals: [slot(0)],
    });
  });

  it('plans a one-day menu again as a whole for its day', () => {
    expect(resolveReplaceTarget([day(0)], menuOf(1))).toBeNull();
  });
});

describe('readTargets', () => {
  it('reads one meal on every day of a menu of more days as the meal without a day', () => {
    expect(readTargets([meal(0), meal(1), meal(2)], 3)).toEqual([meal(null)]);
  });

  it.each<[string, MenuTarget[], number]>([
    ['a meal on some days', [meal(0), meal(2)], 3],
    ['other meals on every day', [meal(0), meal(1, MealType.Lunch), meal(2)], 3],
    ['a meal on every day and a day', [meal(0), meal(1), meal(2), day(1)], 3],
    ['a meal twice on a day', [meal(0), meal(1), meal(1)], 3],
    ['the meal of a one-day menu', [meal(0)], 1],
    ['a meal on every day and beyond', [meal(0), meal(5)], 2],
    ['days', [day(0), day(1)], 2],
  ])('keeps %s as it is', (_case, targets, menuDays) => {
    expect(readTargets(targets, menuDays)).toBe(targets);
  });
});
