import { MenuTargetScope } from '../../../common/constants';
import { MenuTarget } from '../../../common/contracts';
import { MenuIssue, ResolvedDay } from '../../../common/types';
import { errorsOf } from './menu-rules';
import { MealSlot, MenuReplacement, resolveReplaceTarget } from './menu-target';

const sameSlot = (a: MealSlot, b: MealSlot): boolean =>
  a.dayIndex === b.dayIndex && a.mealType === b.mealType;

const slotsOf = ({ dayIndex, meals }: ResolvedDay): MealSlot[] =>
  meals.map(({ mealType }) => ({ dayIndex, mealType }));

/**
 * The meals `next` changed against `previous`, in the order of the menus: a meal whose recipe,
 * servings or snapshot differ, and every meal of a day whose date or meals differ or that only one
 * of the menus has. Pure.
 */
export function changedSlots(previous: ResolvedDay[], next: ResolvedDay[]): MealSlot[] {
  const dayIndexes = [...new Set([...previous, ...next].map(({ dayIndex }) => dayIndex))].sort(
    (a, b) => a - b,
  );
  return dayIndexes.flatMap((dayIndex) => {
    const before = previous.find((day) => day.dayIndex === dayIndex);
    const after = next.find((day) => day.dayIndex === dayIndex);
    if (!before || !after) {
      return slotsOf(before ?? after);
    }
    const sameShape =
      before.date?.valueOf() === after.date?.valueOf() &&
      before.meals.length === after.meals.length &&
      before.meals.every(({ mealType }, i) => after.meals[i].mealType === mealType);
    if (!sameShape) {
      return [...slotsOf(before), ...slotsOf(after)].filter(
        (slot, i, all) => all.findIndex((other) => sameSlot(other, slot)) === i,
      );
    }
    return after.meals
      .filter((meal, i) => JSON.stringify(meal) !== JSON.stringify(before.meals[i]))
      .map(({ mealType }) => ({ dayIndex, mealType }));
  });
}

/** The `changed` meals outside `scope`. Pure. */
export const outsideScope = (changed: MealSlot[], scope: MealSlot[]): MealSlot[] =>
  changed.filter((slot) => !scope.some((allowed) => sameSlot(allowed, slot)));

/** The meals of `days` with an error among `issues` (a hard rule they break). Pure. */
export function violatingSlots(issues: MenuIssue[], days: ResolvedDay[]): MealSlot[] {
  return errorsOf(issues).flatMap(({ dayIndex, position }) => {
    const mealType = days.find((day) => day.dayIndex === dayIndex)?.meals[position]?.mealType;
    return dayIndex === undefined || mealType === undefined ? [] : [{ dayIndex, mealType }];
  });
}

/**
 * `replacement` with the `extra` meals too, resolved like the targets of a revision
 * (`resolveReplaceTarget`): every meal of a day is the day, a meal of a day replaced is part of it,
 * each once. Null when that is every day, and the whole menu is planned again; `replacement` as it
 * is without `extra`. Pure.
 */
export function widenReplacement(
  replacement: MenuReplacement,
  extra: MealSlot[],
  days: ResolvedDay[],
): MenuReplacement | null {
  if (extra.length === 0) {
    return replacement;
  }
  const targets: MenuTarget[] = [
    ...replacement.days.map((dayIndex) => ({
      scope: MenuTargetScope.Day,
      dayIndex,
      mealType: null,
    })),
    ...[...replacement.meals, ...extra].map(({ dayIndex, mealType }) => ({
      scope: MenuTargetScope.Meal,
      dayIndex,
      mealType,
    })),
  ];
  return resolveReplaceTarget(targets, days);
}
