/**
 * Coverage of the seed recipes: how many there are per meal type for every diet derived from the
 * food categories (rejected recipes left out, as the seed skips them). Exit code 1 when a diet has
 * fewer than `MIN_RECIPES_PER_MEAL` breakfasts, lunches or dinners.
 *
 *   npm run data:coverage
 */
import { foodCategoriesOf } from './lib/classify-recipes';
import { formatCoverageReport, recipeCoverage } from './lib/recipe-coverage';
import { acceptedRecipes, loadSeedData, validateSeedData } from './lib/seed-data';

const data = loadSeedData();
const { errors, rejected } = validateSeedData(data);
if (errors.length > 0) {
  errors.forEach((error) => console.error(`error: ${error}`));
  process.exit(1);
}

const report = recipeCoverage(acceptedRecipes(data.recipes, rejected), foodCategoriesOf(data));
formatCoverageReport(report).forEach((line) => console.log(line));
process.exit(report.shortfalls.length > 0 ? 1 : 0);
