import { PrismaClient } from '../../src/generated/prisma/client';
import { FoodSource, RecipeSource } from '../../src/common/constants';
import { classifyRecipe, FoodCategories, seedDietType } from './classify-recipes';
import { parseFoodRef, SeedFood, SeedRecipe } from './seed-data';
import { SeedTranslations } from './seed-translations';

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
 * tags and the allergens are derived from the food categories (`seedDietType`,
 * `classifyRecipe`); the tags of the file are not used.
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
      allergens: classifyRecipe({ slug, ingredients, ...recipe }, categoriesOf).allergens,
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

export interface TranslationResult {
  locale: string;
  foods: number;
  recipes: number;
  notes: number;
}

/**
 * Writes the translations of the seeded foods and recipes (`recipes`: the ones that were seeded),
 * upserted by (row, locale); a seed row left out of the file loses its translation. Ingredient
 * notes are matched by their English text, the ingredients being recreated by every seed run.
 */
export async function upsertSeedTranslations(
  prisma: PrismaClient,
  translations: SeedTranslations,
  recipes: SeedRecipe[],
): Promise<TranslationResult> {
  const { locale } = translations;
  const result: TranslationResult = { locale, foods: 0, recipes: 0, notes: 0 };

  const foods = await prisma.foodItem.findMany({
    where: { source: { not: FoodSource.Manual } },
    select: { id: true, source: true, sourceId: true },
  });
  const foodRows = foods.flatMap(({ id, source, sourceId }) => {
    const name =
      translations.foods[source === FoodSource.Seed ? sourceId : `${source}:${sourceId}`];
    return name ? [{ foodItemId: id, name }] : [];
  });
  await prisma.$transaction([
    prisma.foodItemTranslation.deleteMany({
      where: {
        locale,
        foodItem: { source: { not: FoodSource.Manual } },
        foodItemId: { notIn: foodRows.map((row) => row.foodItemId) },
      },
    }),
    ...foodRows.map(({ foodItemId, name }) =>
      prisma.foodItemTranslation.upsert({
        where: { foodItemId_locale: { foodItemId, locale } },
        create: { foodItemId, locale, name },
        update: { name },
      }),
    ),
  ]);
  result.foods = foodRows.length;

  const translated = new Set<string>();
  for (const { slug } of recipes) {
    const text = translations.recipes[slug];
    if (!text) {
      continue;
    }
    const recipe = await prisma.recipe.findUnique({
      where: { source_sourceId: { source: RecipeSource.Seed, sourceId: slug } },
      select: { id: true, ingredients: { select: { id: true, notes: true } } },
    });
    if (!recipe) {
      continue;
    }
    translated.add(recipe.id);
    const data = {
      name: text.name,
      description: text.description ?? null,
      instructions: text.instructions,
    };
    const notes = recipe.ingredients.flatMap(({ id, notes: note }) => {
      const noteText = note ? translations.notes[note] : undefined;
      return noteText ? [{ recipeIngredientId: id, notes: noteText }] : [];
    });
    await prisma.$transaction([
      prisma.recipeTranslation.upsert({
        where: { recipeId_locale: { recipeId: recipe.id, locale } },
        create: { recipeId: recipe.id, locale, ...data },
        update: data,
      }),
      ...notes.map(({ recipeIngredientId, notes: noteText }) =>
        prisma.recipeIngredientTranslation.upsert({
          where: { recipeIngredientId_locale: { recipeIngredientId, locale } },
          create: { recipeIngredientId, locale, notes: noteText },
          update: { notes: noteText },
        }),
      ),
    ]);
    result.recipes++;
    result.notes += notes.length;
  }
  await prisma.recipeTranslation.deleteMany({
    where: { locale, recipe: { source: RecipeSource.Seed }, recipeId: { notIn: [...translated] } },
  });

  return result;
}
