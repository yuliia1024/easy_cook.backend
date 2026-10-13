/**
 * Upserts data/seed/recipes.json (source `seed`, source_id = slug). The foods they use must be in
 * the database already: `npm run db:seed` loads the seed foods, `data:import-foods` USDA ones.
 *
 *   npm run data:seed-recipes
 */
import 'dotenv/config';
import { loadSeedData, validateSeedData } from './lib/seed-data';
import { createPrismaClient } from './lib/prisma';
import { upsertSeedRecipes } from './lib/seed-db';

async function main(): Promise<void> {
  const data = loadSeedData();
  const { errors } = validateSeedData(data);
  if (errors.length > 0) {
    throw new Error(`Seed data is invalid, run npm run data:validate:\n${errors.join('\n')}`);
  }

  const prisma = createPrismaClient();
  try {
    const { created, updated } = await upsertSeedRecipes(prisma, data.recipes);
    console.log(`Recipes: ${created} created, ${updated} updated`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
