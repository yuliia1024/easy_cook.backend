import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  DietTag,
  FoodCategory,
  FoodSource,
  FoodState,
  KCAL_PER_GRAM,
  MAX_KCAL_PER_100G,
  MealType,
} from '../../src/common/constants';
import { FoodValues } from '../../src/modules/services/nutrition/nutrition.service';
import { ImportedFood } from './fdc';
import { checkRecipeRules } from './recipe-rules';

export const SEED_DIR = resolve(__dirname, '../../data/seed');

/** A row of `data/seed/foods.json`. Values per 100 g, null = unknown. */
export interface SeedFood {
  slug: string;
  name: string;
  nameEn?: string | null;
  state: string;
  kcalPer100g: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
}

export interface SeedIngredient {
  /** A slug of `foods.json`, or `<source>:<sourceId>` of an imported food. */
  food: string;
  quantityG: number;
  isOptional?: boolean;
  notes?: string | null;
}

/** A row of `data/seed/recipes.json` or `data/seed/menu-recipes.json`. */
export interface SeedRecipe {
  slug: string;
  name: string;
  description?: string | null;
  instructions: string;
  mealType: string;
  dietType: string[];
  servings: number;
  prepTimeMinutes?: number | null;
  ingredients: SeedIngredient[];
}

/** A row of `data/seed/food-categories.json`. */
export interface SeedFoodCategories {
  /** A food ref, like `SeedIngredient.food`. */
  food: string;
  /** The name of that food, for the reader. */
  name: string;
  categories: FoodCategory[];
}

export interface SeedData {
  foods: SeedFood[];
  /** `data/seed/usda-foods.json`: the USDA foods the recipes use, referenced as `usda_fdc:<id>`. */
  importedFoods: ImportedFood[];
  recipes: SeedRecipe[];
  /** Categories of the foods the recipes use; recipe diet tags and allergens come from them. */
  foodCategories: SeedFoodCategories[];
}

export interface ValidationReport {
  /** Data that must not be loaded. */
  errors: string[];
  /** Suspicious but loadable data. */
  warnings: string[];
  /** Well-formed recipes that break an import rule (`checkRecipeRules`); they are not seeded. */
  rejected: RecipeRejection[];
}

export interface RecipeRejection {
  slug: string;
  reasons: string[];
}

export interface FoodRef {
  source: string;
  sourceId: string;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Allowed gap between the stated kcal and 4/9/4 kcal per gram of protein/fat/carbs. */
const KCAL_TOLERANCE = { absolute: 15, relative: 0.15 };

export function loadSeedData(dir: string = SEED_DIR): SeedData {
  const json = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const read = <T>(file: string, key: string): T[] =>
    (json(file) as Record<string, T[]>)[key] ?? [];

  return {
    foods: read<SeedFood>('foods.json', 'foods'),
    importedFoods: json('usda-foods.json') as ImportedFood[],
    recipes: [
      ...read<SeedRecipe>('recipes.json', 'recipes'),
      ...read<SeedRecipe>('menu-recipes.json', 'recipes'),
    ],
    foodCategories: read<SeedFoodCategories>('food-categories.json', 'foods'),
  };
}

/** `chicken-breast-raw` -> seed food, `usda_fdc:171477` -> imported food. */
export function parseFoodRef(ref: string): FoodRef {
  const separator = ref.indexOf(':');
  return separator === -1
    ? { source: FoodSource.Seed, sourceId: ref }
    : { source: ref.slice(0, separator), sourceId: ref.slice(separator + 1) };
}

export function estimateKcal({
  proteinG,
  fatG,
  carbsG,
}: Pick<SeedFood, 'proteinG' | 'fatG' | 'carbsG'>): number {
  return proteinG * KCAL_PER_GRAM.protein + fatG * KCAL_PER_GRAM.fat + carbsG * KCAL_PER_GRAM.carbs;
}

/**
 * Checks the seed files without a database: shapes, ranges and references between them, and the
 * import rules of every well-formed recipe (a recipe that breaks one goes to `rejected`).
 */
export function validateSeedData({
  foods,
  importedFoods,
  recipes,
  foodCategories,
}: SeedData): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const foodSlugs = new Set<string>();
  foods.forEach((food, index) => {
    const at = `foods[${index}] "${food.slug}"`;

    if (!SLUG.test(food.slug ?? '')) errors.push(`${at}: slug must be kebab-case`);
    if (foodSlugs.has(food.slug)) errors.push(`${at}: duplicate slug`);
    foodSlugs.add(food.slug);

    if (!food.name?.trim()) errors.push(`${at}: name is empty`);
    if (!Object.values<string>(FoodState).includes(food.state)) {
      errors.push(`${at}: unknown state "${food.state}"`);
    }

    const ranges: Array<[keyof SeedFood, number]> = [
      ['kcalPer100g', MAX_KCAL_PER_100G],
      ['proteinG', 100],
      ['fatG', 100],
      ['carbsG', 100],
    ];
    for (const [field, max] of ranges) {
      const value = food[field];
      if (value === null || value === undefined) {
        warnings.push(`${at}: ${field} is unknown`);
      } else if (typeof value !== 'number' || value < 0 || value > max) {
        errors.push(`${at}: ${field} must be a number between 0 and ${max}`);
      }
    }

    const { kcalPer100g, proteinG, fatG, carbsG } = food;
    if ([proteinG, fatG, carbsG].every((v) => typeof v === 'number')) {
      if (proteinG + fatG + carbsG > 100) {
        errors.push(`${at}: protein + fat + carbs exceed 100 g`);
      }
      if (typeof kcalPer100g === 'number') {
        const estimate = estimateKcal(food);
        const tolerance = Math.max(KCAL_TOLERANCE.absolute, kcalPer100g * KCAL_TOLERANCE.relative);
        if (Math.abs(estimate - kcalPer100g) > tolerance) {
          warnings.push(
            `${at}: ${kcalPer100g} kcal differs from 4/9/4 estimate ${Math.round(estimate)} kcal`,
          );
        }
      }
    }
  });

  // Plain numbers where the DB has Decimals: NutritionService reads both through toNumber.
  const foodsByRef = new Map<string, FoodValues>([
    ...foods.map((f): [string, FoodValues] => [
      f.slug,
      { id: f.slug, ...f } as unknown as FoodValues,
    ]),
    ...importedFoods.map((f): [string, FoodValues] => {
      const ref = `${f.source}:${f.sourceId}`;
      return [ref, { id: ref, ...f } as unknown as FoodValues];
    }),
  ]);
  const categorized = new Set<string>();
  foodCategories.forEach(({ food, name, categories }, index) => {
    const at = `foodCategories[${index}] "${food}"`;

    if (categorized.has(food)) errors.push(`${at}: duplicate food`);
    categorized.add(food);

    const known = foodsByRef.get(food);
    if (!known) {
      errors.push(`${at}: unknown food`);
    } else if (known.name !== name) {
      errors.push(`${at}: name must be "${known.name}"`);
    }
    if (!categories?.length) errors.push(`${at}: has no categories`);
    for (const category of categories ?? []) {
      if (!Object.values<string>(FoodCategory).includes(category))
        errors.push(`${at}: unknown category "${category}"`);
    }
  });

  const rejected: RecipeRejection[] = [];
  const recipeSlugs = new Set<string>();
  recipes.forEach((recipe, index) => {
    const errorCount = errors.length;
    const at = `recipes[${index}] "${recipe.slug}"`;

    if (!SLUG.test(recipe.slug ?? '')) errors.push(`${at}: slug must be kebab-case`);
    if (recipeSlugs.has(recipe.slug)) errors.push(`${at}: duplicate slug`);
    recipeSlugs.add(recipe.slug);

    if (!recipe.name?.trim()) errors.push(`${at}: name is empty`);
    if (!Object.values<string>(MealType).includes(recipe.mealType)) {
      errors.push(`${at}: unknown meal type "${recipe.mealType}"`);
    }

    const tags = recipe.dietType ?? [];
    for (const tag of tags) {
      if (!Object.values<string>(DietTag).includes(tag))
        errors.push(`${at}: unknown diet tag "${tag}"`);
    }
    if (new Set(tags).size !== tags.length) errors.push(`${at}: duplicate diet tags`);

    if (!Number.isInteger(recipe.servings) || recipe.servings < 1) {
      errors.push(`${at}: servings must be a positive integer`);
    }
    if (
      recipe.prepTimeMinutes !== undefined &&
      recipe.prepTimeMinutes !== null &&
      (!Number.isInteger(recipe.prepTimeMinutes) || recipe.prepTimeMinutes < 0)
    ) {
      errors.push(`${at}: prepTimeMinutes must be a non-negative integer`);
    }

    if (!recipe.ingredients?.length) {
      errors.push(`${at}: has no ingredients`);
      return;
    }
    recipe.ingredients.forEach((ingredient, i) => {
      if (typeof ingredient.quantityG !== 'number' || ingredient.quantityG <= 0) {
        errors.push(
          `${at} ingredient ${i} "${ingredient.food}": quantityG must be a positive number`,
        );
      }
    });
    if (errors.length > errorCount) return;

    const rules = checkRecipeRules({
      instructions: recipe.instructions,
      servings: recipe.servings,
      ingredients: recipe.ingredients.map((ingredient) => ({
        label: ingredient.food,
        quantityG: ingredient.quantityG,
        isOptional: ingredient.isOptional ?? false,
        foodItem: foodsByRef.get(ingredient.food) ?? null,
      })),
    });
    const uncategorized = recipe.ingredients
      .filter(({ food }) => foodsByRef.has(food) && !categorized.has(food))
      .map(({ food }) => food);
    if (uncategorized.length > 0) {
      rules.reasons.push(`no categories in food-categories.json: ${uncategorized.join(', ')}`);
    }

    rules.warnings.forEach((warning) => warnings.push(`${at}: ${warning}`));
    if (rules.reasons.length > 0) rejected.push({ slug: recipe.slug, reasons: rules.reasons });
  });

  return { errors, warnings, rejected };
}

/** The recipes to seed: all but the rejected ones. */
export function acceptedRecipes(recipes: SeedRecipe[], rejected: RecipeRejection[]): SeedRecipe[] {
  const slugs = new Set(rejected.map((r) => r.slug));
  return recipes.filter((recipe) => !slugs.has(recipe.slug));
}

/** One line per rejected recipe, with every reason. */
export function formatRejections(rejected: RecipeRejection[]): string[] {
  return rejected.map(({ slug, reasons }) => `rejected ${slug}: ${reasons.join('; ')}`);
}
