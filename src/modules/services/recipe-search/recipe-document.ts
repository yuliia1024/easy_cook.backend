import { createHash } from 'node:crypto';
import {
  RECIPE_DOCUMENT_INSTRUCTIONS_MAX_LENGTH,
  RECIPE_DOCUMENT_VERSION,
} from '../../../common/constants';
import { RecipeWithIngredients } from '../../data-access/recipe/recipe.repository';

/** The text a recipe is embedded and full-text searched by, and its hash. */
export interface RecipeDocument {
  recipeId: string;
  documentVersion: number;
  content: string;
  contentHash: string;
}

/** Name parts that say how a food is weighed or sold, not what it is (USDA names are full of them). */
const FOOD_NAME_NOISE =
  /^(raw|cooked|boiled|steamed|fried|baked|roasted|dried|dry|canned|frozen|refrigerated|fresh|whole|plain|enriched|unprepared|ready-to-serve|mature seeds|choice|without salt.*|drained.*|trimmed.*|separable.*|salad or cooking|\d+% .*)$/i;
const FOOD_NAME_MAX_PARTS = 3;

/**
 * "Fish, flatfish (flounder and sole species), raw" -> "Fish flatfish": the parts that name the
 * food, without the state, the brackets and the packaging.
 */
export function foodSearchName(name: string): string {
  const parts = name
    .replace(/\([^)]*\)/g, ' ')
    .split(',')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part !== '' && !FOOD_NAME_NOISE.test(part));
  return (parts.length > 0 ? parts : [name.trim()]).slice(0, FOOD_NAME_MAX_PARTS).join(' ');
}

/** "Куряче філе, сире" -> "Куряче філе": a translated name up to its first comma, no brackets. */
export function translatedFoodSearchName(name: string): string {
  const head = name
    .replace(/\([^)]*\)/g, ' ')
    .split(',')[0]
    .replace(/\s+/g, ' ')
    .trim();
  return head || name.trim();
}

const label = (tag: string): string => tag.replace(/_/g, '-');

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max).replace(/\s+\S*$/, '')}...`;

/**
 * One document per recipe - a recipe is short, so it is a single chunk: the name first (models
 * weigh the start), then what a request names - meal, diets, time, ingredients - then the method.
 * Nutrition and allergens stay out: numbers and negations embed badly, the filters handle them.
 * The translations (`Locale`) follow - name, description, ingredients, without the method - so a
 * request in that language matches too. Any change of the output raises `RECIPE_DOCUMENT_VERSION`.
 */
export function buildRecipeDocument(recipe: RecipeWithIngredients): RecipeDocument {
  const ingredients = [
    ...new Set(recipe.ingredients.map(({ foodItem }) => foodSearchName(foodItem.name))),
  ];
  const lines = [
    recipe.name.trim(),
    recipe.description?.trim(),
    [
      `Meal: ${label(recipe.mealType)}.`,
      recipe.dietType.length > 0 ? `Diet: ${recipe.dietType.map(label).join(', ')}.` : null,
      recipe.prepTimeMinutes ? `Ready in ${recipe.prepTimeMinutes} minutes.` : null,
    ]
      .filter((part) => part !== null)
      .join(' '),
    ingredients.length > 0 ? `Ingredients: ${ingredients.join(', ')}.` : null,
    `Method: ${truncate(recipe.instructions.replace(/\s+/g, ' ').trim(), RECIPE_DOCUMENT_INSTRUCTIONS_MAX_LENGTH)}`,
    ...translationLines(recipe),
  ].filter((line): line is string => typeof line === 'string' && line !== '');
  const content = lines.join('\n');
  return {
    recipeId: recipe.id,
    documentVersion: RECIPE_DOCUMENT_VERSION,
    content,
    contentHash: createHash('sha256')
      .update(`${RECIPE_DOCUMENT_VERSION}\n${content}`)
      .digest('hex'),
  };
}

/** Per locale, in locale order: `Name (uk): ...`, `Description (uk): ...`, `Ingredients (uk): ...`. */
function translationLines(recipe: RecipeWithIngredients): string[] {
  return [...recipe.translations]
    .sort((a, b) => a.locale.localeCompare(b.locale))
    .flatMap(({ locale, name, description }) => {
      const ingredients = [
        ...new Set(
          recipe.ingredients.flatMap(({ foodItem }) =>
            foodItem.translations
              .filter((translation) => translation.locale === locale)
              .map((translation) => translatedFoodSearchName(translation.name)),
          ),
        ),
      ];
      return [
        `Name (${locale}): ${name.trim()}`,
        description?.trim() ? `Description (${locale}): ${description.trim()}` : null,
        ingredients.length > 0 ? `Ingredients (${locale}): ${ingredients.join(', ')}.` : null,
      ].filter((line): line is string => line !== null);
    });
}
