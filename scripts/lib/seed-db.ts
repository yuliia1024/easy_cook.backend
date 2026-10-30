import { PrismaClient } from '../../src/generated/prisma/client';
import { FoodSource, RecipeSource } from '../../src/common/constants';
import { FoodCategories, seedDietType } from './classify-recipes';
import { parseFoodRef, SeedFood, SeedRecipe } from './seed-data';

export interface UpsertResult {
  created: number;
  updated: number;
}

/** Inserts or refreshes the seed foods, keyed by (`seed`, slug). */
export async function upsertSeedFoods(
  prisma: PrismaClient,
  foods: SeedFood[],
): Promise<UpsertResult> {
  const result: UpsertResult = { created: 0, updated: 0 };

  for (const { slug, ...food } of foods) {
    const data = { ...food, nameEn: food.nameEn ?? null };
    const key = { source: FoodSource.Seed, sourceId: slug };
    const existing = await prisma.foodItem.findUnique({
      where: { source_sourceId: key },
      select: { id: true },
    });

    if (existing) {
      await prisma.foodItem.update({ where: { id: existing.id }, data });
      result.updated++;
    } else {
      await prisma.foodItem.create({ data: { ...data, ...key } });
      result.created++;
    }
  }

  return result;
}

/** Food id per reference used by the recipes. Throws listing every reference not in the DB. */
export async function resolveFoodRefs(
  prisma: PrismaClient,
  recipes: SeedRecipe[],
): Promise<Map<string, string>> {
  const refs = [...new Set(recipes.flatMap((r) => r.ingredients.map((i) => i.food)))];
  const ids = new Map<string, string>();
  const missing: string[] = [];

  for (const ref of refs) {
    const food = await prisma.foodItem.findUnique({
      where: { source_sourceId: parseFoodRef(ref) },
      select: { id: true },
    });
    if (food) {
      ids.set(ref, food.id);
    } else {
      missing.push(ref);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Foods not found (seed the foods / import USDA data first): ${missing.join(', ')}`,
    );
  }
  return ids;
}

/**
 * Inserts or refreshes the seed recipes, keyed by (`seed`, slug). An existing recipe gets its
 * fields updated and its ingredient list replaced, each recipe in its own transaction. The diet
 * tags are derived from the food categories (`seedDietType`), not taken from the file.
 */
export async function upsertSeedRecipes(
  prisma: PrismaClient,
  recipes: SeedRecipe[],
  categoriesOf: FoodCategories,
): Promise<UpsertResult> {
  const foodIds = await resolveFoodRefs(prisma, recipes);
  const result: UpsertResult = { created: 0, updated: 0 };

  for (const { slug, ingredients, ...recipe } of recipes) {
    const key = { source: RecipeSource.Seed, sourceId: slug };
    const data = {
      ...recipe,
      dietType: seedDietType({ slug, ingredients, ...recipe }, categoriesOf),
      description: recipe.description ?? null,
      prepTimeMinutes: recipe.prepTimeMinutes ?? null,
    };
    const rows = ingredients.map((ingredient, position) => ({
      foodItemId: foodIds.get(ingredient.food),
      quantityG: ingredient.quantityG,
      isOptional: ingredient.isOptional ?? false,
      notes: ingredient.notes ?? null,
      position,
    }));

    await prisma.$transaction(async (tx) => {
      const existing = await tx.recipe.findUnique({
        where: { source_sourceId: key },
        select: { id: true },
      });

      if (existing) {
        await tx.recipeIngredient.deleteMany({ where: { recipeId: existing.id } });
        await tx.recipe.update({
          where: { id: existing.id },
          data: { ...data, ingredients: { create: rows } },
        });
        result.updated++;
      } else {
        await tx.recipe.create({ data: { ...data, ...key, ingredients: { create: rows } } });
        result.created++;
      }
    });
  }

  return result;
}

/** Rows of an external dataset, keyed by (`source`, `sourceId`). */
export interface ExternalFood {
  name: string;
  nameEn: string | null;
  kcalPer100g: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  state: string;
  source: string;
  sourceId: string;
}

/** Upserts in batches, one transaction per batch. Returns the number of rows written. */
export async function upsertExternalFoods(
  prisma: PrismaClient,
  foods: ExternalFood[],
  batchSize = 200,
): Promise<number> {
  for (let start = 0; start < foods.length; start += batchSize) {
    const batch = foods.slice(start, start + batchSize);
    await prisma.$transaction(
      batch.map((food) =>
        prisma.foodItem.upsert({
          where: { source_sourceId: { source: food.source, sourceId: food.sourceId } },
          create: food,
          update: food,
        }),
      ),
    );
  }
  return foods.length;
}
