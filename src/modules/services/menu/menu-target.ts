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

/** One meal of a day of the menu. */
export interface MealSlot {
  dayIndex: number;
  mealType: MealType;
}

/**
 * What a revision replaces: whole days (`dayIndex`es) and single meals of other days, both in the
 * order of the menu. Their counts are the days and the meals the revision changes.
 */
export interface MenuReplacement {
  days: number[];
  meals: MealSlot[];
}

/**
 * The day a target of one day or one meal is about: the one it names, or the only day of a
 * one-day menu. Null when it names none on a menu of more days. Pure.
 */
export const targetDayIndex = (target: MenuTarget, days: ResolvedDay[]): number | null =>
  target.dayIndex ?? (days.length === 1 ? days[0].dayIndex : null);

/**
 * The question for a target the menu cannot pin down, null when it can: a day the menu does not
 * have, a meal without a day on a menu of more days, or a meal the day does not have. A change
 * to the whole menu is never unclear. Pure.
 */
export function targetClarification(
  target: MenuTarget,
  days: ResolvedDay[],
): { message: string; missingFields: MenuTargetField[] } | null {
  if (target.scope === MenuTargetScope.Menu) {
    return null;
  }
  const dayIndex = targetDayIndex(target, days);
  const day = days.find((current) => current.dayIndex === dayIndex);
  if (target.dayIndex !== null && !day) {
    return {
      message: menuTargetMissingDayReply(days.length),
      missingFields: [MenuTargetField.DayIndex],
    };
  }
  if (target.scope !== MenuTargetScope.Meal) {
    return null;
  }
  if (!day) {
    return {
      message: menuTargetDayReply(target.mealType, days.length),
      missingFields: [MenuTargetField.DayIndex],
    };
  }
  if (!day.meals.some(({ mealType }) => mealType === target.mealType)) {
    return {
      message: menuTargetMissingMealReply(
        target.mealType,
        day.meals.map(({ mealType }) => mealType),
      ),
      missingFields: [MenuTargetField.MealType],
    };
  }
  return null;
}

/**
 * The targets as the app reads them for a menu of `menuDays` days: one meal named on every day of
 * a menu of more days, and nothing else, is that meal without a day, as the model lists every day
 * for "swap the lunch"; so it is asked about (`targetClarification`). "Every lunch" is a change to
 * the whole menu. Pure.
 */
export function readTargets(targets: MenuTarget[], menuDays: number): MenuTarget[] {
  const [first] = targets;
  const everyDay =
    menuDays > 1 &&
    targets.length === menuDays &&
    targets.every(
      ({ scope, mealType }) => scope === MenuTargetScope.Meal && mealType === first.mealType,
    ) &&
    new Set(targets.map(({ dayIndex }) => dayIndex)).size === menuDays &&
    targets.every(({ dayIndex }) => dayIndex !== null && dayIndex < menuDays);
  return everyDay ? [{ ...first, dayIndex: null }] : targets;
}

/**
 * The question for the first target of a revision the menu cannot pin down
 * (`targetClarification`), null when it can pin them all down or one of them changes the whole
 * menu, as the whole menu is planned again then. Pure.
 */
export function replacementClarification(
  targets: MenuTarget[],
  days: ResolvedDay[],
): { message: string; missingFields: MenuTargetField[] } | null {
  if (targets.some(({ scope }) => scope === MenuTargetScope.Menu)) {
    return null;
  }
  for (const target of targets) {
    const clarification = targetClarification(target, days);
    if (clarification) {
      return clarification;
    }
  }
  return null;
}

/**
 * The days and the meals the targets of a revision replace, for targets that
 * `replacementClarification` passes: every meal of a day (by the meals the day has in the menu)
 * is the whole day, a meal of a day replaced whole is part of it, and a target named twice counts
 * once. Null when the whole menu is planned again: no target, one about the whole menu, or every
 * day replaced. Pure.
 */
export function resolveReplaceTarget(
  targets: MenuTarget[],
  days: ResolvedDay[],
): MenuReplacement | null {
  if (targets.length === 0 || targets.some(({ scope }) => scope === MenuTargetScope.Menu)) {
    return null;
  }
  const meals = targets
    .filter(({ scope }) => scope === MenuTargetScope.Meal)
    .map((target) => ({ dayIndex: targetDayIndex(target, days), mealType: target.mealType }));
  const isNamed = (dayIndex: number, mealType: MealType): boolean =>
    meals.some((meal) => meal.dayIndex === dayIndex && meal.mealType === mealType);
  const whole = new Set(
    targets
      .filter(({ scope }) => scope === MenuTargetScope.Day)
      .map((target) => targetDayIndex(target, days)),
  );
  days
    .filter(
      (day) =>
        day.meals.length > 0 && day.meals.every(({ mealType }) => isNamed(day.dayIndex, mealType)),
    )
    .forEach(({ dayIndex }) => whole.add(dayIndex));
  if (days.every(({ dayIndex }) => whole.has(dayIndex))) {
    return null;
  }
  return {
    days: days.filter(({ dayIndex }) => whole.has(dayIndex)).map(({ dayIndex }) => dayIndex),
    meals: days
      .filter(({ dayIndex }) => !whole.has(dayIndex))
      .flatMap(({ dayIndex, meals: dayMeals }) =>
        dayMeals
          .filter(({ mealType }) => isNamed(dayIndex, mealType))
          .map(({ mealType }) => ({ dayIndex, mealType })),
      ),
  };
}
