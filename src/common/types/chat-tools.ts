import { ChatToolErrorCode, ChatToolName } from '../constants';
import type { PlanMenuInput, ReviseMenuInput } from '../contracts';
import { MacroValues } from './menu';

/*
 * What the chat tools return to the model. Numbers are rounded to one decimal; a nutrient value
 * that is unknown is null, never 0, and `complete: false` says a total misses some of them.
 */

/** A failed tool call; the model may call the tool again with other arguments. */
export interface ChatToolError {
  error: ChatToolErrorCode;
  message: string;
  /** The arguments that did not pass, as `path: problem`. */
  issues?: string[];
}

export interface RecipeSummaryResult {
  id: string;
  name: string;
  mealType: string;
  diets: string[];
  servings: number;
  prepTimeMinutes: number | null;
  /** Without optional ingredients. */
  perServing: MacroValues;
  complete: boolean;
  /** Whether the profile's diets, allergies and excluded ingredients allow it; null without a profile. */
  fitsProfile: boolean | null;
}

export interface SearchRecipesResult {
  recipes: RecipeSummaryResult[];
  /** More recipes match than are listed. */
  more: boolean;
}

export interface RecipeDetailsResult extends RecipeSummaryResult {
  description: string | null;
  instructions: string;
  allergens: string[];
  ingredients: Array<{
    foodId: string;
    foodName: string;
    /** The values of the food are for this state (raw, dry, boiled...). */
    state: string;
    /** For the whole recipe. */
    quantityG: number;
    isOptional: boolean;
  }>;
}

/** Per 100 g of the food in its `state`; null is unknown. */
export interface NutrientValues {
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
}

export interface FoodNutritionResult {
  id: string;
  name: string;
  state: string;
  per100g: NutrientValues;
  quantityG: number;
  forQuantity: NutrientValues;
}

export interface GetFoodNutritionResult {
  foods: FoodNutritionResult[];
}

export interface CalculateNutritionResult {
  servings: number;
  total: MacroValues;
  perServing: MacroValues;
  /** False when a food has an unknown value: the real numbers are higher. */
  complete: boolean;
  items: Array<{
    foodId: string;
    foodName: string;
    state: string;
    quantityG: number;
    macros: MacroValues;
    /** The nutrients the food has no value for, counted as 0 in `macros`. */
    missing: string[];
  }>;
}

/** A `service_call` tool the model called with valid arguments; the backend runs it. */
export type ChatServiceCall =
  | { name: ChatToolName.PlanMenu; input: PlanMenuInput }
  | { name: ChatToolName.ReviseMenu; input: ReviseMenuInput };
