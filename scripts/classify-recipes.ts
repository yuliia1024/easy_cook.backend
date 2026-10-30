/**
 * Derives the diet tags and allergens of the seed recipes from data/seed/food-categories.json and
 * reports where the derived tags differ from the tags in the recipe files. `db:seed` stores the
 * derived tags; a contradicted source tag is worth fixing in the recipe file.
 *
 *   npm run data:classify
 *   npm run data:classify -- --all      # also the tags and allergens of every recipe
 */
import { parseArgs } from 'util';
import { classifyRecipes, formatClassificationReport } from './lib/classify-recipes';
import { acceptedRecipes, loadSeedData, validateSeedData } from './lib/seed-data';

const { values } = parseArgs({ options: { all: { type: 'boolean', default: false } } });

const data = loadSeedData();
const { errors, rejected } = validateSeedData(data);
if (errors.length > 0) {
  errors.forEach((error) => console.error(`error: ${error}`));
  process.exit(1);
}

// Rejected recipes are not seeded, and a food they use may have no categories.
const reports = classifyRecipes({ ...data, recipes: acceptedRecipes(data.recipes, rejected) });
if (values.all) {
  for (const { slug, dietType, allergens } of reports) {
    console.log(
      `${slug}: ${dietType.join(', ') || '-'} | allergens: ${allergens.join(', ') || '-'}`,
    );
  }
  console.log('');
}
formatClassificationReport(reports).forEach((line) => console.log(line));
