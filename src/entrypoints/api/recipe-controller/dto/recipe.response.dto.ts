import { DietTag, MealType } from '../../../../common/constants';
import { toNumber } from '../../../../common/utils';
import {
  IngredientWithFood,
  RecipeWithIngredients,
} from '../../../../modules/data-access/recipe/recipe.repository';
import { Macros, RecipeNutrition } from '../../../../modules/services/nutrition/nutrition.service';
import { FoodItemResponseDto } from '../../dto/food-item.response.dto';

export class RecipeIngredientResponseDto {
  id: string;
  foodItemId: string;
  quantityG: number;
  isOptional: boolean;
  notes: string | null;
  position: number;
  foodItem: FoodItemResponseDto;

  static from(ingredient: IngredientWithFood): RecipeIngredientResponseDto {
    return {
      id: ingredient.id,
      foodItemId: ingredient.foodItemId,
      quantityG: toNumber(ingredient.quantityG),
      isOptional: ingredient.isOptional,
      notes: ingredient.notes,
      position: ingredient.position,
      foodItem: FoodItemResponseDto.from(ingredient.foodItem),
    };
  }
}

export class MacrosResponseDto implements Macros {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

export class RecipeResponseDto {
  id: string;
  name: string;
  description: string | null;
  instructions: string;
  mealType: MealType;
  dietType: DietTag[];
  servings: number;
  prepTimeMinutes: number | null;
  source: string;
  sourceId: string | null;
  createdAt: Date;
  updatedAt: Date;
  ingredients: RecipeIngredientResponseDto[];
  /** Without optional ingredients. Details: `GET /recipes/:id/nutrition`. */
  nutritionPerServing: MacrosResponseDto;
  /** False when an ingredient has an unknown nutrient value. */
  nutritionComplete: boolean;

  static from(recipe: RecipeWithIngredients, nutrition: RecipeNutrition): RecipeResponseDto {
    return {
      id: recipe.id,
      name: recipe.name,
      description: recipe.description,
      instructions: recipe.instructions,
      mealType: recipe.mealType as MealType,
      dietType: recipe.dietType as DietTag[],
      servings: recipe.servings,
      prepTimeMinutes: recipe.prepTimeMinutes,
      source: recipe.source,
      sourceId: recipe.sourceId,
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
      ingredients: recipe.ingredients.map(RecipeIngredientResponseDto.from),
      nutritionPerServing: nutrition.perServing,
      nutritionComplete: nutrition.complete,
    };
  }
}
