import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Locale } from '../../src/common/constants';
import { SEED_DIR, SeedData } from './seed-data';

export const TRANSLATIONS_DIR = join(SEED_DIR, 'translations');

export interface SeedRecipeTranslation {
  name: string;
  description: string | null;
  instructions: string;
}

/** `data/seed/translations/<locale>.json`: the seed catalog in one language. */
export interface SeedTranslations {
  locale: string;
  /** Food ref (like `SeedIngredient.food`) -> name. */
  foods: Record<string, string>;
  /** Recipe slug -> its text. */
  recipes: Record<string, SeedRecipeTranslation>;
  /** English ingredient note -> its translation. */
  notes: Record<string, string>;
}

export interface TranslationReport {
  errors: string[];
  /** Untranslated foods, recipes and notes: the English text is shown for them. */
  warnings: string[];
}

/** Every `*.json` of the directory, in file name order; none when the directory is missing. */
export function loadSeedTranslations(dir: string = TRANSLATIONS_DIR): SeedTranslations[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith('.json'));
  } catch {
    return [];
  }
  return files.sort().map((file) => {
    const { locale, foods, recipes, notes } = JSON.parse(
      readFileSync(join(dir, file), 'utf8'),
    ) as Partial<SeedTranslations>;
    return { locale: locale ?? '', foods: foods ?? {}, recipes: recipes ?? {}, notes: notes ?? {} };
  });
}

/** Checks the translations against the seed data: known locale, known keys, no empty text. */
export function validateSeedTranslations(
  translations: SeedTranslations[],
  { foods, importedFoods, recipes }: SeedData,
): TranslationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const foodRefs = new Set([
    ...foods.map((food) => food.slug),
    ...importedFoods.map((food) => `${food.source}:${food.sourceId}`),
  ]);
  const slugs = new Set(recipes.map((recipe) => recipe.slug));
  const notes = new Set(
    recipes.flatMap((recipe) =>
      recipe.ingredients.map((i) => i.notes).filter((note): note is string => Boolean(note)),
    ),
  );
  const seen = new Set<string>();

  for (const { locale, foods: foodNames, recipes: texts, notes: noteTexts } of translations) {
    const at = `translations "${locale}"`;
    if (!Object.values<string>(Locale).includes(locale)) {
      errors.push(`${at}: unknown locale`);
    }
    if (seen.has(locale)) errors.push(`${at}: duplicate locale`);
    seen.add(locale);

    for (const [ref, name] of Object.entries(foodNames)) {
      if (!foodRefs.has(ref)) errors.push(`${at}: food "${ref}" is not in the seed foods`);
      if (!name?.trim()) errors.push(`${at}: food "${ref}" has an empty name`);
    }
    for (const [slug, text] of Object.entries(texts)) {
      if (!slugs.has(slug)) errors.push(`${at}: recipe "${slug}" is not in the seed recipes`);
      if (!text?.name?.trim()) errors.push(`${at}: recipe "${slug}" has an empty name`);
      if (!text?.instructions?.trim()) {
        errors.push(`${at}: recipe "${slug}" has empty instructions`);
      }
    }
    for (const [note, text] of Object.entries(noteTexts)) {
      if (!notes.has(note)) warnings.push(`${at}: note "${note}" is not used by any recipe`);
      if (!text?.trim()) errors.push(`${at}: note "${note}" has an empty translation`);
    }

    const missing = (kind: string, keys: Iterable<string>, done: object): void => {
      const left = [...keys].filter((key) => !(key in done));
      if (left.length > 0)
        warnings.push(`${at}: ${left.length} ${kind} untranslated: ${left.join(', ')}`);
    };
    missing('foods', foodRefs, foodNames);
    missing('recipes', slugs, texts);
    missing('notes', notes, noteTexts);
  }

  return { errors, warnings };
}
