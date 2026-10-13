/**
 * `npm run db:seed` (also run by `prisma migrate reset`): the base foods and recipes of
 * data/seed. Idempotent - rows are keyed by (`seed`, slug) and refreshed on every run.
 */
import { loadSeedData, validateSeedData } from '../scripts/lib/seed-data';
import { createPrismaClient } from '../scripts/lib/prisma';
import { upsertSeedFoods, upsertSeedRecipes } from '../scripts/lib/seed-db';

async function main(): Promise<void> {
  const data = loadSeedData();
  const { errors } = validateSeedData(data);
  if (errors.length > 0) {
    throw new Error(`Seed data is invalid, run npm run data:validate:\n${errors.join('\n')}`);
  }

  const prisma = createPrismaClient();
  try {
    const foods = await upsertSeedFoods(prisma, data.foods);
    console.log(`Foods: ${foods.created} created, ${foods.updated} updated`);

    const recipes = await upsertSeedRecipes(prisma, data.recipes);
    console.log(`Recipes: ${recipes.created} created, ${recipes.updated} updated`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
