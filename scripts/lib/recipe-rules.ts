import { IMPORT_SERVING_KCAL } from '../../src/common/constants';
import { Numeric } from '../../src/common/utils';
import {
  FoodValues,
  NutritionService,
} from '../../src/modules/services/nutrition/nutrition.service';

/** A recipe as the import rules see it, from the seed files or from the database. */
export interface RuleRecipe {
  instructions: string | null | undefined;
  servings: number;
  ingredients: RuleIngredient[];
}

export interface RuleIngredient {
  /** How the reasons name the ingredient: a food ref or a food name. */
  label: string;
  quantityG: Numeric;
  isOptional: boolean;
  /** Null when the ingredient is not matched to a food. */
  foodItem: FoodValues | null;
}

export interface RuleResult {
  /** Why the recipe must not be imported; empty when it may be. */
  reasons: string[];
  warnings: string[];
}

/**
 * The import rules of a recipe: an instruction, every ingredient matched to a food, every
 * nutrient of the counted (non-optional) ingredients known, and the calories of one serving
 * within `IMPORT_SERVING_KCAL`. Unknown values of an optional ingredient are only a warning.
 */
export function checkRecipeRules(
  recipe: RuleRecipe,
  nutrition: NutritionService = new NutritionService(),
): RuleResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (!recipe.instructions?.trim()) reasons.push('no instructions');

  const unmatched = recipe.ingredients.filter((i) => i.foodItem === null).map((i) => i.label);
  if (unmatched.length > 0) {
    reasons.push(`ingredients not matched to a food: ${unmatched.join(', ')}`);
    return { reasons, warnings };
  }

  const result = nutrition.calculateRecipe({
    id: '',
    servings: recipe.servings,
    ingredients: recipe.ingredients.map((ingredient, index) => ({
      id: String(index),
      quantityG: ingredient.quantityG,
      isOptional: ingredient.isOptional,
      foodItem: ingredient.foodItem as FoodValues,
    })),
  });
  result.ingredients.forEach((line, index) => {
    if (line.missing.length === 0) return;
    const unknown = `${recipe.ingredients[index].label} has no ${line.missing.join(', ')}`;
    (line.counted ? reasons : warnings).push(unknown);
  });

  const { kcal } = result.perServing;
  if (kcal < IMPORT_SERVING_KCAL.min || kcal > IMPORT_SERVING_KCAL.max) {
    reasons.push(
      `${kcal} kcal per serving, outside ${IMPORT_SERVING_KCAL.min}-${IMPORT_SERVING_KCAL.max}`,
    );
  }

  return { reasons, warnings };
}
