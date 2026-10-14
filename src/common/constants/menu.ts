import { MealType } from './recipe';

export const MENU_TITLE_MAX_LENGTH = 255;
export const MENU_NOTES_MAX_LENGTH = 2000;
export const MAX_MENU_DAYS = 14;
export const MAX_MEALS_PER_DAY = 8;
/** Menu dates are today or later, at most this many days ahead. */
export const MENU_DATE_MAX_FUTURE_DAYS = 365;
/** Portions of the recipe eaten in one meal. */
export const MENU_MEAL_SERVINGS = { min: 0.25, max: 10 } as const;

/** Meals of a generated day when the request names none. */
export const DEFAULT_MENU_MEAL_TYPES: readonly MealType[] = [
  MealType.Breakfast,
  MealType.Lunch,
  MealType.Dinner,
];

/** Share of the daily calories each meal aims at; normalised over the meals of the day. */
export const MEAL_CALORIE_SHARE: Record<MealType, number> = {
  [MealType.Breakfast]: 0.25,
  [MealType.Lunch]: 0.35,
  [MealType.Dinner]: 0.3,
  [MealType.Snack]: 0.1,
};

/** How far a day may be from the calorie goal before the menu gets a warning. */
export const MENU_DAY_KCAL_TOLERANCE = 0.15;

/** Planner proposals rejected by the validation are sent back this many times at most. */
export const MAX_MENU_PLANNING_ATTEMPTS = 3;

/** Recipes per meal type offered to the planner. */
export const MAX_PLANNING_CANDIDATES = 200;

export enum MenuIssueSeverity {
  /**
   * A hard rule is broken (allergy, diet, unknown recipe). Meals added with an error are rejected
   * and a version with errors cannot be confirmed; errors of meals carried over from an earlier
   * version (the preferences changed since) are saved so the user can replace those meals.
   */
  Error = 'error',
  Warning = 'warning',
}

export enum MenuIssueCode {
  RecipeNotFound = 'recipe_not_found',
  DietViolation = 'diet_violation',
  Allergen = 'allergen',
  ExcludedIngredient = 'excluded_ingredient',
  DislikedFood = 'disliked_food',
  CaloriesOffTarget = 'calories_off_target',
  NutritionIncomplete = 'nutrition_incomplete',
  /** A planner proposal that does not fit the request (days, meals, servings). */
  InvalidProposal = 'invalid_proposal',
}
