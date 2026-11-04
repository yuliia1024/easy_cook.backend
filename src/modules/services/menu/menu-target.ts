import {
  MenuTargetField,
  MenuTargetScope,
  menuTargetDayReply,
  menuTargetMissingDayReply,
  menuTargetMissingMealReply,
} from '../../../common/constants';
import { MenuTarget } from '../../../common/contracts';
import { ResolvedDay } from '../../../common/types';

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
