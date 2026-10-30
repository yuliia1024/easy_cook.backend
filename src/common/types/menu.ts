import { CalculationMode, MealType, MenuIssueCode, MenuIssueSeverity } from '../constants';

export interface MacroValues {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

/**
 * A recipe as it was when a menu version was built. The version keeps it, so later edits or the
 * deletion of the recipe do not change history.
 */
export interface RecipeSnapshot {
  id: string;
  name: string;
  mealType: string;
  dietType: string[];
  /** `Allergen[]`; missing in snapshots taken before recipes had allergens. */
  allergens?: string[];
  servings: number;
  prepTimeMinutes: number | null;
  /** Without optional ingredients. */
  perServing: MacroValues;
  /** False when a counted ingredient has an unknown nutrient value. */
  complete: boolean;
  ingredients: Array<{
    foodItemId: string;
    foodName: string;
    foodNameEn: string | null;
    state: string;
    quantityG: number;
    isOptional: boolean;
  }>;
}

/** A day whose meals are resolved to recipe snapshots. */
export interface ResolvedDay {
  dayIndex: number;
  date: Date | null;
  meals: ResolvedMeal[];
}

export interface ResolvedMeal {
  mealType: MealType;
  servings: number;
  /** Null when the recipe was deleted and only its snapshot is left. */
  recipeId: string | null;
  recipe: RecipeSnapshot;
}

export interface MenuIssue {
  severity: MenuIssueSeverity;
  code: MenuIssueCode;
  message: string;
  dayIndex?: number;
  /** Position of the meal within the day. */
  position?: number;
  recipeId?: string | null;
}

/** The dietary preferences of the profile, as the rules a menu must follow. */
export interface PreferenceRules {
  /** Every recipe must satisfy each of these diets (`DIET_SATISFIED_BY`). */
  diets: string[];
  /** No ingredient may match one of these (optional ingredients included). */
  allergies: string[];
  excludedIngredients: string[];
  /** Allowed, but the menu gets a warning. */
  dislikedFoods: string[];
}

/** The daily goal a menu version was built for. */
export interface NutritionGoalSnapshot {
  goalId: string;
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  calculationMode: CalculationMode;
  ruleVersion: string | null;
}

export interface MealComposition {
  position: number;
  mealType: MealType;
  recipeId: string | null;
  recipeName: string;
  servings: number;
  /** Per serving of the recipe times `servings`. */
  nutrition: MacroValues;
  complete: boolean;
}

export interface DayComposition {
  dayIndex: number;
  /** `YYYY-MM-DD`. */
  date: string | null;
  meals: MealComposition[];
  totals: MacroValues;
  complete: boolean;
}

/** Stored as `menu_versions.composition_snapshot`. */
export interface MenuComposition {
  days: DayComposition[];
  /** Averages over the days. */
  dailyAverage: MacroValues;
  /** Found when the version was built; see `MenuIssueSeverity` for when errors are kept. */
  issues: MenuIssue[];
}
