import {
  CalculateNutritionResult,
  FoodNutritionResult,
  NutrientValues,
  PreferenceRules,
  RecipeDetailsResult,
  RecipeSummaryResult,
} from '../../../common/types';
import { round, toNumber } from '../../../common/utils';
import { FoodItem } from '../../../generated/prisma/client';
import { RecipeWithIngredients } from '../../data-access/recipe/recipe.repository';
import { isRecipeAllowed } from '../menu/menu-rules';
import { Macros, NutritionService, RecipeNutrition } from '../nutrition/nutrition.service';

/*
 * The results of the read tools, as the model reads them (`chat-tools` types). Pure: the services
 * load the data and `NutritionService` does the maths.
 */

const roundOrNull = (value: number | null): number | null => (value === null ? null : round(value));

export function toRecipeSummary(
  recipe: RecipeWithIngredients,
  nutrition: RecipeNutrition,
  rules: PreferenceRules | null,
): RecipeSummaryResult {
  return {
    id: recipe.id,
    name: recipe.name,
    mealType: recipe.mealType,
    diets: recipe.dietType,
    servings: recipe.servings,
    prepTimeMinutes: recipe.prepTimeMinutes,
    perServing: nutrition.perServing,
    complete: nutrition.complete,
    fitsProfile: rules ? isRecipeAllowed(recipe, rules) : null,
  };
}

export function toRecipeDetails(
  recipe: RecipeWithIngredients,
  nutrition: RecipeNutrition,
  rules: PreferenceRules | null,
): RecipeDetailsResult {
  return {
    ...toRecipeSummary(recipe, nutrition, rules),
    description: recipe.description,
    instructions: recipe.instructions,
    allergens: recipe.allergens,
    ingredients: recipe.ingredients.map((ingredient) => ({
      foodId: ingredient.foodItem.id,
      foodName: ingredient.foodItem.name,
      state: ingredient.foodItem.state,
      quantityG: toNumber(ingredient.quantityG),
      isOptional: ingredient.isOptional,
    })),
  };
}

/** The values of 100 g and of `quantityG`; an unknown value stays null in both. */
export function toFoodNutrition(
  food: FoodItem,
  quantityG: number,
  nutritionService: NutritionService,
): FoodNutritionResult {
  const per100g: NutrientValues = {
    kcal: roundOrNull(toNumber(food.kcalPer100g)),
    proteinG: roundOrNull(toNumber(food.proteinG)),
    fatG: roundOrNull(toNumber(food.fatG)),
    carbsG: roundOrNull(toNumber(food.carbsG)),
  };
  const { macros, missing } = nutritionService.forQuantity(food, quantityG);
  const known = (macro: keyof Macros): number | null =>
    missing.includes(macro) ? null : round(macros[macro]);
  return {
    id: food.id,
    name: food.name,
    state: food.state,
    per100g,
    quantityG,
    forQuantity: {
      kcal: known('kcal'),
      proteinG: known('proteinG'),
      fatG: known('fatG'),
      carbsG: known('carbsG'),
    },
  };
}

export function toNutritionCalculation(nutrition: RecipeNutrition): CalculateNutritionResult {
  return {
    servings: nutrition.servings,
    total: nutrition.total,
    perServing: nutrition.perServing,
    complete: nutrition.complete,
    items: nutrition.ingredients.map((ingredient) => ({
      foodId: ingredient.foodItemId,
      foodName: ingredient.foodName,
      state: ingredient.state,
      quantityG: ingredient.quantityG,
      macros: ingredient.macros,
      missing: ingredient.missing,
    })),
  };
}
