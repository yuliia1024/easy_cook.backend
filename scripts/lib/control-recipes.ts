import { readFileSync } from 'fs';
import { join } from 'path';
import { FoodSource } from '../../src/common/constants';
import {
  FoodValues,
  Macro,
  Macros,
  MACROS,
  NutritionIngredientInput,
  NutritionService,
  RecipeNutrition,
} from '../../src/modules/services/nutrition/nutrition.service';
import { parseFoodRef, SEED_DIR, SeedData } from './seed-data';

/** A row of `data/seed/control-recipes.json`: hand-computed nutrition of a seed recipe. */
export interface ControlRecipe {
  /** Slug of a recipe in `recipes.json`. */
  slug: string;
  servings: number;
  /** The arithmetic, for a human to re-check. */
  calculation: string[];
  /** Optional ingredients excluded. */
  total: Macros;
  perServing: Macros;
}

/** Allowed gap between the hand-computed value and `NutritionService` (which rounds to 0.1). */
export const CONTROL_TOLERANCE: Record<Macro, number> = {
  kcal: 0.5,
  proteinG: 0.1,
  fatG: 0.1,
  carbsG: 0.1,
};

export const CONTROL_RECIPES_FILE = 'control-recipes.json';

export function loadControlRecipes(dir: string = SEED_DIR): ControlRecipe[] {
  return JSON.parse(readFileSync(join(dir, CONTROL_RECIPES_FILE), 'utf8')).recipes ?? [];
}

/** Differences beyond `CONTROL_TOLERANCE`, e.g. `perServing.kcal: expected 302.8, got 310`. */
export function compareNutrition(
  expected: Pick<ControlRecipe, 'total' | 'perServing'>,
  actual: Pick<RecipeNutrition, 'total' | 'perServing'>,
): string[] {
  const mismatches: string[] = [];

  for (const part of ['total', 'perServing'] as const) {
    for (const macro of MACROS) {
      const want = expected[part]?.[macro];
      const got = actual[part][macro];
      if (typeof want !== 'number' || Math.abs(want - got) > CONTROL_TOLERANCE[macro]) {
        mismatches.push(`${part}.${macro}: expected ${want}, got ${got}`);
      }
    }
  }

  return mismatches;
}

/**
 * Checks the control file against the seed files without a database: every control recipe
 * exists, uses seed foods only, and its expected values match `NutritionService` run over the
 * values of `foods.json`.
 */
export function validateControlRecipes(
  controls: ControlRecipe[],
  { foods, recipes }: SeedData,
): string[] {
  const errors: string[] = [];
  const nutrition = new NutritionService();
  const foodsBySlug = new Map(foods.map((food) => [food.slug, food]));
  const seen = new Set<string>();

  controls.forEach((control, index) => {
    const at = `control-recipes[${index}] "${control.slug}"`;

    if (seen.has(control.slug)) errors.push(`${at}: duplicate slug`);
    seen.add(control.slug);

    const recipe = recipes.find((r) => r.slug === control.slug);
    if (!recipe) {
      errors.push(`${at}: no such recipe in recipes.json`);
      return;
    }
    if (control.servings !== recipe.servings) {
      errors.push(`${at}: servings ${control.servings}, the recipe has ${recipe.servings}`);
    }
    if (!control.calculation?.length) errors.push(`${at}: calculation is empty`);

    const ingredients: NutritionIngredientInput[] = [];
    for (const [i, ingredient] of recipe.ingredients.entries()) {
      const ref = parseFoodRef(ingredient.food);
      const food = ref.source === FoodSource.Seed ? foodsBySlug.get(ref.sourceId) : undefined;
      if (!food) {
        errors.push(`${at}: ingredient "${ingredient.food}" is not a food of foods.json`);
        return;
      }
      ingredients.push({
        id: String(i),
        quantityG: ingredient.quantityG,
        isOptional: ingredient.isOptional ?? false,
        // Plain numbers where the DB has Decimals: NutritionService reads both through toNumber.
        foodItem: { id: food.slug, ...food } as unknown as FoodValues,
      });
    }

    const actual = nutrition.calculateRecipe({
      id: recipe.slug,
      servings: recipe.servings,
      ingredients,
    });
    compareNutrition(control, actual).forEach((m) => errors.push(`${at}: ${m}`));
  });

  return errors;
}
