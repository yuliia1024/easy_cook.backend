/**
 * Upserts data/seed/recipes.json and menu-recipes.json (source `seed`, source_id = slug). The
 * foods they use must be in the database already: `npm run db:seed` loads them. Recipes that
 * break an import rule are skipped and listed with the reasons.
 *
 *   npm run data:seed-recipes
 */
import 'dotenv/config';
import { foodCategoriesOf } from './lib/classify-recipes';
import { acceptedRecipes, formatRejections, loadSeedData, validateSeedData } from './lib/seed-data';
import { createPrismaClient } from './lib/prisma';
import { upsertSeedRecipes } from './lib/seed-db';

async function main(): Promise<void> {
  const data = loadSeedData();
  const { errors, rejected } = validateSeedData(data);
  if (errors.length > 0) {
    throw new Error(`Seed data is invalid, run npm run data:validate:\n${errors.join('\n')}`);
  }

  const prisma = createPrismaClient();
  try {
    const { created, updated } = await upsertSeedRecipes(
      prisma,
      acceptedRecipes(data.recipes, rejected),
      foodCategoriesOf(data),
    );
    console.log(`Recipes: ${created} created, ${updated} updated, ${rejected.length} rejected`);
    formatRejections(rejected).forEach((line) => console.warn(line));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
