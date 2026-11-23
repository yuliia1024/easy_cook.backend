import { ModelMessage } from 'ai';
import {
  MENU_DAY_MAX_OUTPUT_TOKENS,
  MENU_DAY_PROMPT,
  MENU_PLAN_MEAL_TYPES,
} from '../../../common/constants';
import { MenuDayPlan, MenuDayPlanSchema } from '../../../common/contracts';
import { MenuComposition, ProfileContext, ResolvedDay } from '../../../common/types';
import { ModelCallOptions } from '../../../providers/llm/llm.service';
import { toModelProfile } from '../profile-context/model-profile';
import { candidateProblems, MenuPlanCandidates, PlannedDay } from './menu-plan';
import { errorsOf } from './menu-rules';

/** One call that plans a day again: the input, the schema of the answer and the options. */
export interface MenuDayModelCall {
  input: ModelMessage[];
  schema: typeof MenuDayPlanSchema;
  options: ModelCallOptions;
}

/** The recipes served on every day of the menu but `dayIndex`; deleted recipes have none. Pure. */
export function otherDaysRecipeIds(days: ResolvedDay[], dayIndex: number): Set<string> {
  return new Set(
    days
      .filter((day) => day.dayIndex !== dayIndex)
      .flatMap((day) => day.meals.map(({ recipeId }) => recipeId))
      .filter((recipeId): recipeId is string => recipeId !== null),
  );
}

/**
 * The recipes without the `excluded` ones. A meal that would be left without any keeps all of its
 * recipes: a recipe served on another day is better than no day. Pure.
 */
export function withoutRecipes<T extends { id: string; mealType: string }>(
  recipes: T[],
  excluded: Set<string>,
): T[] {
  const kept = recipes.filter(({ id }) => !excluded.has(id));
  const emptyMeals = new Set<string>(
    MENU_PLAN_MEAL_TYPES.filter(
      (mealType) =>
        recipes.some((recipe) => recipe.mealType === mealType) &&
        !kept.some((recipe) => recipe.mealType === mealType),
    ),
  );
  if (emptyMeals.size === 0) {
    return kept;
  }
  return recipes.filter((recipe) => !excluded.has(recipe.id) || emptyMeals.has(recipe.mealType));
}

/** The menu with `day` in place of the day of the same `dayIndex`; the others are the same objects. Pure. */
export const replaceDay = (days: ResolvedDay[], day: ResolvedDay): ResolvedDay[] =>
  days.map((current) => (current.dayIndex === day.dayIndex ? day : current));

/**
 * The call that plans the day `dayIndex` again for the request, the profile and the candidates of
 * every meal. The menu day evals (`evals/suites/menu-day`) run the same call.
 */
export function menuDayModelCall(
  request: string,
  dayIndex: number,
  profile: ProfileContext,
  candidates: MenuPlanCandidates,
  abortSignal?: AbortSignal,
): MenuDayModelCall {
  return {
    input: [
      {
        role: 'user',
        content: JSON.stringify({
          request,
          dayIndex,
          profile: toModelProfile(profile),
          recipes: candidates,
        }),
      },
    ],
    schema: MenuDayPlanSchema,
    options: {
      prompt: MENU_DAY_PROMPT,
      maxOutputTokens: MENU_DAY_MAX_OUTPUT_TOKENS,
      abortSignal,
    },
  };
}

/**
 * Everything wrong with a planned day, as sentences the model can act on: a meal that is not a
 * candidate, then the errors of the whole menu `compose` makes with the day in it that are on that
 * day. Errors of the other days are kept in the menu's issues, but the model cannot fix them, as
 * those days do not change. Pure when `compose` is.
 */
export function menuDayErrors(
  plan: MenuDayPlan,
  candidates: MenuPlanCandidates,
  dayIndex: number,
  compose: (meals: PlannedDay) => MenuComposition,
): string[] {
  const unknown = candidateProblems(
    { message: plan.message, days: [{ dayIndex, meals: plan.meals }] },
    candidates,
  );
  if (unknown.length > 0) {
    return unknown;
  }
  return errorsOf(compose(plan.meals).issues)
    .filter((issue) => issue.dayIndex === undefined || issue.dayIndex === dayIndex)
    .map(({ message }) => `${message}.`);
}
