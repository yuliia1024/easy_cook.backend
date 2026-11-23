import { ModelMessage } from 'ai';
import {
  MENU_DAY_KCAL_TOLERANCE,
  MENU_MEAL_MAX_OUTPUT_TOKENS,
  MENU_MEAL_PROMPT,
  MENU_SERVINGS_MAX,
  MENU_SERVINGS_MIN,
  MENU_SERVINGS_STEP,
  MealType,
} from '../../../common/constants';
import { MenuMealPlan, MenuMealPlanSchema } from '../../../common/contracts';
import { MenuComposition, ProfileContext, ResolvedDay, ResolvedMeal } from '../../../common/types';
import { ModelCallOptions } from '../../../providers/llm/llm.service';
import { toModelProfile } from '../profile-context/model-profile';
import { MenuPlanCandidate } from './menu-plan';
import { withoutRecipes } from './menu-day';
import { errorsOf } from './menu-rules';

/** One call that replaces a meal: the input, the schema of the answer and the options. */
export interface MenuMealModelCall {
  input: ModelMessage[];
  schema: typeof MenuMealPlanSchema;
  options: ModelCallOptions;
}

/** Every servings value a meal can have, smallest first. */
const SERVINGS = Array.from(
  { length: Math.round((MENU_SERVINGS_MAX - MENU_SERVINGS_MIN) / MENU_SERVINGS_STEP) + 1 },
  (_, i) => MENU_SERVINGS_MIN + i * MENU_SERVINGS_STEP,
);

/** The recipes served anywhere in the menu; deleted recipes have none. Pure. */
export function menuRecipeIds(days: ResolvedDay[]): Set<string> {
  return new Set(
    days
      .flatMap((day) => day.meals.map(({ recipeId }) => recipeId))
      .filter((recipeId): recipeId is string => recipeId !== null),
  );
}

/** The kcal of the meals of the day but the `mealType` one. Pure. */
export const otherMealsKcal = (day: ResolvedDay, mealType: MealType): number =>
  day.meals
    .filter((meal) => meal.mealType !== mealType)
    .reduce((total, meal) => total + meal.recipe.perServing.kcal * meal.servings, 0);

/**
 * The servings of a recipe of `kcal` per serving that bring a day whose other meals have
 * `otherKcal` closest to `dailyKcal`, within `MENU_SERVINGS_MIN`..`MENU_SERVINGS_MAX`; of equally
 * close ones, the nearest to one serving. Pure.
 */
export function mealServings(kcal: number, otherKcal: number, dailyKcal: number): number {
  const miss = (servings: number): number => Math.abs(otherKcal + kcal * servings - dailyKcal);
  return [...SERVINGS].sort((a, b) => miss(a) - miss(b) || Math.abs(a - 1) - Math.abs(b - 1))[0];
}

/** Whether `mealServings` of the recipe keep the day within `MENU_DAY_KCAL_TOLERANCE`. Pure. */
export function fitsDayKcal(kcal: number, otherKcal: number, dailyKcal: number): boolean {
  const servings = mealServings(kcal, otherKcal, dailyKcal);
  return Math.abs(otherKcal + kcal * servings - dailyKcal) <= dailyKcal * MENU_DAY_KCAL_TOLERANCE;
}

/**
 * The recipes of the `mealType` meal of `day` that the menu does not serve yet: another one than
 * the old recipe of the meal while there is one, and one served elsewhere in the menu rather than
 * none (`withoutRecipes`). Pure.
 */
export function mealRecipes<T extends { id: string; mealType: string }>(
  recipes: T[],
  days: ResolvedDay[],
  day: ResolvedDay,
  mealType: MealType,
): T[] {
  const old = day.meals.find((meal) => meal.mealType === mealType)?.recipeId ?? null;
  const notOld = withoutRecipes(
    recipes.filter((recipe) => recipe.mealType === mealType),
    new Set(old === null ? [] : [old]),
  );
  return withoutRecipes(notOld, menuRecipeIds(days));
}

/**
 * The recipes whose `mealServings` keep a day whose other meals have `otherKcal` within
 * `MENU_DAY_KCAL_TOLERANCE` of `dailyKcal` (`fitsDayKcal`); all of them without daily calories or
 * when none does. Pure.
 */
export function fittingDayKcal<T>(
  recipes: T[],
  kcalOf: (recipe: T) => number,
  otherKcal: number,
  dailyKcal: number | null,
): T[] {
  if (dailyKcal === null) {
    return recipes;
  }
  const fitting = recipes.filter((recipe) => fitsDayKcal(kcalOf(recipe), otherKcal, dailyKcal));
  return fitting.length > 0 ? fitting : recipes;
}

/** The day with `meal` in place of the meal of its type; the others are the same objects. Pure. */
export const replaceMeal = (day: ResolvedDay, meal: ResolvedMeal): ResolvedDay => ({
  ...day,
  meals: day.meals.map((current) => (current.mealType === meal.mealType ? meal : current)),
});

/**
 * The call that replaces the `mealType` meal of `day` for the request, the profile and the
 * candidates of that meal; the model sees the other meals of the day by name. The menu day evals
 * (`evals/suites/menu-day`) run the same call.
 */
export function menuMealModelCall(
  request: string,
  day: ResolvedDay,
  mealType: MealType,
  profile: ProfileContext,
  candidates: MenuPlanCandidate[],
  abortSignal?: AbortSignal,
): MenuMealModelCall {
  return {
    input: [
      {
        role: 'user',
        content: JSON.stringify({
          request,
          dayIndex: day.dayIndex,
          mealType,
          day: day.meals
            .filter((meal) => meal.mealType !== mealType)
            .map((meal) => ({ mealType: meal.mealType, name: meal.recipe.name })),
          profile: toModelProfile(profile),
          recipes: candidates,
        }),
      },
    ],
    schema: MenuMealPlanSchema,
    options: {
      prompt: MENU_MEAL_PROMPT,
      maxOutputTokens: MENU_MEAL_MAX_OUTPUT_TOKENS,
      abortSignal,
    },
  };
}

/** The recipe of a replaced meal when it is not a candidate, as a sentence the model can act on. Pure. */
export function mealCandidateProblems(
  plan: MenuMealPlan,
  candidates: MenuPlanCandidate[],
  dayIndex: number,
  mealType: MealType,
): string[] {
  return candidates.some(({ id }) => id === plan.recipe)
    ? []
    : [
        `dayIndex ${dayIndex}, ${mealType}: "${plan.recipe}" is not an id from the ${mealType} recipes.`,
      ];
}

/**
 * Everything wrong with a replaced meal, as sentences the model can act on: a recipe that is not
 * a candidate, then the errors of the whole menu `compose` makes with the meal in it that are on
 * that meal (the meal at `position` of the day `dayIndex`) or on the whole menu. Errors of the
 * other meals are kept in the menu's issues, but the model cannot fix them. Pure when `compose` is.
 */
export function menuMealErrors(
  plan: MenuMealPlan,
  candidates: MenuPlanCandidate[],
  dayIndex: number,
  mealType: MealType,
  position: number,
  compose: (recipe: string) => MenuComposition,
): string[] {
  const unknown = mealCandidateProblems(plan, candidates, dayIndex, mealType);
  if (unknown.length > 0) {
    return unknown;
  }
  return errorsOf(compose(plan.recipe).issues)
    .filter(
      (issue) =>
        issue.dayIndex === undefined ||
        (issue.dayIndex === dayIndex &&
          (issue.position === undefined || issue.position === position)),
    )
    .map(({ message }) => `${message}.`);
}
