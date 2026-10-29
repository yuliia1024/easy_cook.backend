import { MealType } from './recipe';

export const MENU_TITLE_MAX_LENGTH = 255;
export const MENU_MIN_DAYS = 1;
/** A longer request is not cut silently: the chat offers this many days instead. */
export const MENU_MAX_DAYS = 7;

/** How far a day may be from the calorie goal before the menu gets a warning. */
export const MENU_DAY_KCAL_TOLERANCE = 0.15;

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
