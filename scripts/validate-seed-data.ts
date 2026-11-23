/**
 * Validates data/seed/*.json and data/seed/translations/*.json without a database. Exit code 1 on errors and on rejected recipes
 * (a recipe that breaks an import rule, listed with the reasons; the seed skips it). The expected values of
 * control-recipes.json are re-checked against NutritionService over foods.json.
 *
 *   npm run data:validate
 *   npm run data:validate -- --quiet      # errors only
 */
import { parseArgs } from 'util';
import { loadControlRecipes, validateControlRecipes } from './lib/control-recipes';
import { formatRejections, loadSeedData, validateSeedData } from './lib/seed-data';
import { loadSeedTranslations, validateSeedTranslations } from './lib/seed-translations';

const { values } = parseArgs({ options: { quiet: { type: 'boolean', default: false } } });

const data = loadSeedData();
const controls = loadControlRecipes();
const { errors, warnings, rejected } = validateSeedData(data);
errors.push(...validateControlRecipes(controls, data));
const translations = loadSeedTranslations();
const translationReport = validateSeedTranslations(translations, data);
errors.push(...translationReport.errors);
warnings.push(...translationReport.warnings);

console.log(
  `${data.foods.length} foods, ${data.recipes.length} recipes, ${controls.length} control recipes, ` +
    `translations: ${translations.map((t) => t.locale).join(', ') || 'none'}`,
);
if (!values.quiet) {
  warnings.forEach((warning) => console.warn(`warning: ${warning}`));
}
errors.forEach((error) => console.error(`error: ${error}`));
formatRejections(rejected).forEach((line) => console.error(line));
console.log(
  `${errors.length} errors, ${warnings.length} warnings, ${rejected.length} rejected recipes`,
);

process.exit(errors.length > 0 || rejected.length > 0 ? 1 : 0);
