import { Injectable } from '@nestjs/common';
import { FoodItem } from '../../../generated/prisma/client';
import { Numeric, round, toNumber } from '../../../common/utils';

export const MACROS = ['kcal', 'proteinG', 'fatG', 'carbsG'] as const;
export type Macro = (typeof MACROS)[number];
export type Macros = Record<Macro, number>;

/** Which `food_items` column holds each macro per 100 g. */
const PER_100G_FIELD: Record<Macro, 'kcalPer100g' | 'proteinG' | 'fatG' | 'carbsG'> = {
  kcal: 'kcalPer100g',
  proteinG: 'proteinG',
  fatG: 'fatG',
  carbsG: 'carbsG',
};

export type FoodValues = Pick<
  FoodItem,
  'id' | 'name' | 'state' | 'kcalPer100g' | 'proteinG' | 'fatG' | 'carbsG'
>;

export interface NutritionIngredientInput {
  id: string;
  quantityG: Numeric;
  isOptional: boolean;
  foodItem: FoodValues;
}

export interface NutritionRecipeInput {
  id: string;
  servings: number;
  ingredients: NutritionIngredientInput[];
}

export interface IngredientNutrition {
  ingredientId: string;
  foodItemId: string;
  foodName: string;
  /** The values are those of the food in this state (raw, dried, boiled...). */
  state: string;
  quantityG: number;
  isOptional: boolean;
  /** False for an optional ingredient left out of the totals. */
  counted: boolean;
  /** For `quantityG`. An unknown nutrient counts as 0 and is listed in `missing`. */
  macros: Macros;
  missing: Macro[];
}

export interface RecipeNutrition {
  recipeId: string;
  servings: number;
  includeOptional: boolean;
  /**
   * The sum of the ingredients as listed. Water loss, oil left in the pan and other cooking
   * changes are not accounted for, so this is not a lab value of the finished dish.
   */
  basis: 'ingredients_sum';
  total: Macros;
  perServing: Macros;
  /** False when a counted ingredient has an unknown nutrient value. */
  complete: boolean;
  ingredients: IngredientNutrition[];
}

export interface RecipeNutritionOptions {
  /** Count optional ingredients too. Default false. */
  includeOptional?: boolean;
}

const emptyMacros = (): Macros => ({ kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 });

const roundMacros = (macros: Macros): Macros => ({
  kcal: round(macros.kcal),
  proteinG: round(macros.proteinG),
  fatG: round(macros.fatG),
  carbsG: round(macros.carbsG),
});

/**
 * Deterministic nutrition maths, independent of the database and of any LLM:
 * `value = quantity_g / 100 * nutrient_per_100g`, summed over the ingredients.
 * Rounding happens only on output, so totals are not built from rounded parts.
 */
@Injectable()
export class NutritionService {
  /** Unrounded values; `missing` lists the nutrients the food has no value for. */
  public forQuantity(food: FoodValues, quantityG: number): { macros: Macros; missing: Macro[] } {
    const macros = emptyMacros();
    const missing: Macro[] = [];

    for (const macro of MACROS) {
      const per100g = toNumber(food[PER_100G_FIELD[macro]]);
      if (per100g === null) {
        missing.push(macro);
      } else {
        macros[macro] = (quantityG / 100) * per100g;
      }
    }

    return { macros, missing };
  }

  public calculateIngredient(
    ingredient: NutritionIngredientInput,
    counted = true,
  ): IngredientNutrition {
    const quantityG = toNumber(ingredient.quantityG);
    const { macros, missing } = this.forQuantity(ingredient.foodItem, quantityG);

    return {
      ingredientId: ingredient.id,
      foodItemId: ingredient.foodItem.id,
      foodName: ingredient.foodItem.name,
      state: ingredient.foodItem.state,
      quantityG,
      isOptional: ingredient.isOptional,
      counted,
      macros: roundMacros(macros),
      missing,
    };
  }

  public calculateRecipe(
    recipe: NutritionRecipeInput,
    { includeOptional = false }: RecipeNutritionOptions = {},
  ): RecipeNutrition {
    const total = emptyMacros();
    let complete = true;

    const ingredients = recipe.ingredients.map((ingredient) => {
      const counted = includeOptional || !ingredient.isOptional;

      if (counted) {
        const { macros, missing } = this.forQuantity(
          ingredient.foodItem,
          toNumber(ingredient.quantityG),
        );
        for (const macro of MACROS) {
          total[macro] += macros[macro];
        }
        complete &&= missing.length === 0;
      }

      return this.calculateIngredient(ingredient, counted);
    });

    const servings = Math.max(recipe.servings, 1);
    const perServing = emptyMacros();
    for (const macro of MACROS) {
      perServing[macro] = total[macro] / servings;
    }

    return {
      recipeId: recipe.id,
      servings: recipe.servings,
      includeOptional,
      basis: 'ingredients_sum',
      total: roundMacros(total),
      perServing: roundMacros(perServing),
      complete,
      ingredients,
    };
  }
}
