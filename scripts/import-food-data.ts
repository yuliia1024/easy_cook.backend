/**
 * Imports USDA FoodData Central foods into `food_items` (source `usda_fdc`, source_id = FDC id).
 *
 *   npm run data:import-foods -- --dir data/raw/FoodData_Central_foundation_food_csv_2026-04-30
 *   npm run data:import-foods -- --dir <dir> --data-types foundation_food,sr_legacy_food --dry-run
 *
 * Writes the normalized rows to data/processed/usda-foods.json, then upserts them, so running it
 * again refreshes the values instead of duplicating foods. See README -> "Datasets".
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { parseArgs } from 'util';
import { DEFAULT_DATA_TYPES, readFdcExport } from './lib/fdc';
import { createPrismaClient } from './lib/prisma';
import { upsertExternalFoods } from './lib/seed-db';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      'data-types': { type: 'string', default: DEFAULT_DATA_TYPES.join(',') },
      out: { type: 'string', default: 'data/processed/usda-foods.json' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  if (!values.dir) {
    throw new Error('Pass --dir <unzipped FoodData Central CSV folder>');
  }

  const dataTypes = values['data-types']
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const foods = await readFdcExport(resolve(values.dir), dataTypes);
  console.log(`Read ${foods.length} foods (${dataTypes.join(', ')})`);

  const out = resolve(values.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(foods, null, 2));
  console.log(`Wrote ${out}`);

  if (values['dry-run']) {
    console.log('Dry run: the database was not changed');
    return;
  }

  const prisma = createPrismaClient();
  try {
    console.log(`Upserted ${await upsertExternalFoods(prisma, foods)} foods`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
