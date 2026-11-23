/**
 * `npm run db:seed` (also run by `prisma migrate reset`): the base foods, the USDA foods the
 * recipes use, the recipes of data/seed that pass the import rules (the rejected ones are
 * listed with the reasons) and their translations (data/seed/translations/). Idempotent - rows are keyed by (source, source id)
 * and refreshed on every run.
 */
import { foodCategoriesOf } from '../scripts/lib/classify-recipes';
import {
  acceptedRecipes,
  formatRejections,
  loadSeedData,
  validateSeedData,
} from '../scripts/lib/seed-data';
import { createPrismaClient } from '../scripts/lib/prisma';
import {
  upsertExternalFoods,
  upsertSeedFoods,
  upsertSeedRecipes,
  upsertSeedTranslations,
} from '../scripts/lib/seed-db';
import { loadSeedTranslations, validateSeedTranslations } from '../scripts/lib/seed-translations';

async function main(): Promise<void> {
  const data = loadSeedData();
  const { errors, rejected } = validateSeedData(data);
  if (errors.length > 0) {
    throw new Error(`Seed data is invalid, run npm run data:validate:\n${errors.join('\n')}`);
  }
  const translations = loadSeedTranslations();
  const translationErrors = validateSeedTranslations(translations, data).errors;
  if (translationErrors.length > 0) {
    throw new Error(
      `Seed translations are invalid, run npm run data:validate:\n${translationErrors.join('\n')}`,
    );
  }

  const prisma = createPrismaClient();
  try {
    const foods = await upsertSeedFoods(prisma, data.foods);
    console.log(`Foods: ${foods.created} created, ${foods.updated} updated`);

    const imported = await upsertExternalFoods(prisma, data.importedFoods);
    console.log(`USDA foods: ${imported} upserted`);

    const accepted = acceptedRecipes(data.recipes, rejected);
    const recipes = await upsertSeedRecipes(prisma, accepted, foodCategoriesOf(data));
    console.log(
      `Recipes: ${recipes.created} created, ${recipes.updated} updated, ${rejected.length} rejected`,
    );
    formatRejections(rejected).forEach((line) => console.warn(line));

    for (const translation of translations) {
      const written = await upsertSeedTranslations(prisma, translation, accepted);
      console.log(
        `Translations (${written.locale}): ${written.foods} foods, ${written.recipes} recipes, ${written.notes} ingredient notes`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
