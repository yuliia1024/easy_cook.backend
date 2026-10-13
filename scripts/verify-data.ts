/**
 * Checks the data in the database (DATABASE_URL). Exit code 1 when a check fails.
 *
 *   npm run data:verify
 *
 * - every foreign key of prisma/schema.prisma has no orphan rows (LEFT JOIN per key);
 * - (source, source_id) is unique in food_items and recipes; every recipe has ingredients;
 * - the recipes of data/seed/control-recipes.json give the hand-computed nutrition when run
 *   through NutritionService;
 * - prints counts: foods by source, recipes, ingredients.
 */
import 'dotenv/config';
import { loadControlRecipes } from './lib/control-recipes';
import { createPrismaClient } from './lib/prisma';
import { formatReport, verifyData } from './lib/verify-data';

async function main(): Promise<boolean> {
  const prisma = createPrismaClient();
  try {
    const report = await verifyData(prisma, loadControlRecipes());
    formatReport(report).forEach((line) => console.log(line));
    return report.ok;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
