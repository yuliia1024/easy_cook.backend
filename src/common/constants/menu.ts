import { MealType } from './recipe';

export const MENU_TITLE_MAX_LENGTH = 255;
/** The title of a menu the chat generated, until the user renames it. */
export const generatedMenuTitle = (days: number): string => `${days}-day menu`;
export const MENU_MIN_DAYS = 1;
/** A longer request is not cut silently: the chat offers this many days instead. */
export const MENU_MAX_DAYS = 7;

/** How far a day may be from the calorie goal before the menu gets a warning. */
export const MENU_DAY_KCAL_TOLERANCE = 0.15;
/**
 * A planned meal is one serving of its recipe, changed in steps of `MENU_SERVINGS_STEP` within
 * `MENU_SERVINGS_MIN`..`MENU_SERVINGS_MAX` until the day is within `MENU_SERVINGS_KCAL_TOLERANCE`
 * of the daily calories: the servings of the seed recipes are smaller than a meal's share.
 */
export const MENU_SERVINGS_STEP = 0.25;
export const MENU_SERVINGS_MIN = 0.5;
export const MENU_SERVINGS_MAX = 2;
export const MENU_SERVINGS_KCAL_TOLERANCE = 0.05;

/** Which menus `GET /menus` lists; a menu is a draft until one of its versions is confirmed. */
export enum MenuStatus {
  Confirmed = 'confirmed',
  Draft = 'draft',
  All = 'all',
}

export enum MenuIssueSeverity {
  /**
   * A hard rule is broken (allergy, diet, excluded ingredient). A version with errors cannot be
   * confirmed.
   */
  Error = 'error',
  Warning = 'warning',
}

export enum MenuIssueCode {
  DietViolation = 'diet_violation',
  Allergen = 'allergen',
  ExcludedIngredient = 'excluded_ingredient',
  DislikedFood = 'disliked_food',
  CaloriesOffTarget = 'calories_off_target',
  NutritionIncomplete = 'nutrition_incomplete',
}

/** The meals of a planned day, in order. */
export const MENU_PLAN_MEAL_TYPES = [
  MealType.Breakfast,
  MealType.Lunch,
  MealType.Snack,
  MealType.Dinner,
] as const;

/**
 * Candidates the planner offers the model per meal: the days plus this many spare, so it can vary
 * the menu, up to `MENU_PLAN_CANDIDATES_MAX` to keep the prompt small.
 */
export const MENU_PLAN_CANDIDATES_SPARE = 5;
export const MENU_PLAN_CANDIDATES_MAX = 12;
/**
 * The candidates rotate within this many times their number of recipes closest to the calorie
 * share of the meal, so a new plan does not get the same ones.
 */
export const MENU_PLAN_CANDIDATE_POOL_FACTOR = 2;
/**
 * The share of the candidates of a meal the recipe search gives when the request has `wishes`
 * ("more fish"); the rest come from the calorie pool, so the model still has a choice.
 */
export const MENU_PLAN_WISHED_SHARE = 0.5;
/**
 * The model sees a candidate by a short id, this prefix and its position ("b1", "l3"): it copies
 * those reliably, unlike the UUIDs of many days.
 */
export const MENU_PLAN_CANDIDATE_PREFIX: Record<(typeof MENU_PLAN_MEAL_TYPES)[number], string> = {
  [MealType.Breakfast]: 'b',
  [MealType.Lunch]: 'l',
  [MealType.Snack]: 's',
  [MealType.Dinner]: 'd',
};
/** The part of the daily calories a meal is expected to bring, to rank its recipes. */
export const MENU_PLAN_MEAL_KCAL_SHARE: Record<(typeof MENU_PLAN_MEAL_TYPES)[number], number> = {
  [MealType.Breakfast]: 0.25,
  [MealType.Lunch]: 0.35,
  [MealType.Snack]: 0.1,
  [MealType.Dinner]: 0.3,
};

/**
 * A good menu serves a recipe for the same meal on at most this many days and never on two days
 * in a row, so a meal of a menu of `days` days needs this many recipes (`menuMinRecipes`). With
 * fewer, the chat explains which rule leaves too few instead of planning.
 */
export const MENU_RECIPE_MAX_DAYS = 2;
/** The ways out of too few recipes the chat offers at most, besides fewer days. */
export const MENU_SHORTAGE_MAX_OPTIONS = 3;

/** A rule of the menu that can leave too few recipes. */
export enum MenuConstraintKind {
  Diet = 'diet',
  ExcludedIngredient = 'excluded_ingredient',
  Allergy = 'allergy',
}
