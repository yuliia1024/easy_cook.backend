export const MENU_TITLE_MAX_LENGTH = 255;

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
