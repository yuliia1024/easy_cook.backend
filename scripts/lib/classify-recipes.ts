import {
  Allergen,
  CATEGORY_ALLERGENS,
  DIET_EXCLUDED_CATEGORIES,
  DIET_SATISFIED_BY,
  DIET_STRICTNESS,
  DietTag,
  FoodCategory,
} from '../../src/common/constants';
import { SeedData, SeedRecipe } from './seed-data';

/** Food ref (`chicken-breast-raw`, `usda_fdc:171477`) -> its categories. */
export type FoodCategories = ReadonlyMap<string, readonly FoodCategory[]>;

export interface RecipeClassification {
  /** The diet tags the categories decide, in `DietTag` order. */
  dietType: DietTag[];
  allergens: Allergen[];
}

export interface RecipeClassificationReport extends RecipeClassification {
  slug: string;
  /** Source tags the ingredients contradict, each with the foods that do. */
  contradicted: { tag: DietTag; foods: string[] }[];
  /** Derived tags the source does not have. */
  untagged: DietTag[];
}

/** The tags that are decided by the categories; the others (`high_protein`...) stay as given. */
export const DERIVED_TAGS = Object.keys(DIET_EXCLUDED_CATEGORIES) as DietTag[];

const inEnumOrder = <T extends string>(values: Iterable<T>, order: Record<string, T>): T[] => {
  const set = new Set(values);
  return Object.values(order).filter((value) => set.has(value));
};

const excludes = (tag: DietTag, categories: readonly FoodCategory[]): boolean =>
  categories.some((category) => DIET_EXCLUDED_CATEGORIES[tag]?.includes(category));

export function foodCategoriesOf({
  foodCategories,
}: Pick<SeedData, 'foodCategories'>): FoodCategories {
  return new Map(foodCategories.map(({ food, categories }) => [food, categories]));
}

/**
 * Diet tags and allergens of a recipe from the categories of all its foods, optional ones
 * included. Of vegan, vegetarian and pescatarian only the strictest allowed one is derived.
 * Throws on a food without categories (`validateSeedData` reports it first).
 */
export function classifyRecipe(
  recipe: SeedRecipe,
  categoriesOf: FoodCategories,
): RecipeClassification {
  const categories = recipe.ingredients.flatMap(({ food }) => {
    const found = categoriesOf.get(food);
    if (!found) {
      throw new Error(`${recipe.slug}: food ${food} has no categories`);
    }
    return found;
  });

  const allowed = DERIVED_TAGS.filter((tag) => !excludes(tag, categories));
  const strictest = DIET_STRICTNESS.find((tag) => allowed.includes(tag));
  const dietType = allowed.filter((tag) => !DIET_STRICTNESS.includes(tag) || tag === strictest);
  const allergens = categories.flatMap((category) => CATEGORY_ALLERGENS[category] ?? []);

  return {
    dietType: inEnumOrder(dietType, DietTag),
    allergens: inEnumOrder(allergens, Allergen),
  };
}

/** The tags a seed recipe is stored with: the derived ones plus the source's other tags. */
export function seedDietType(recipe: SeedRecipe, categoriesOf: FoodCategories): DietTag[] {
  const kept = recipe.dietType.filter((tag) => !DERIVED_TAGS.includes(tag as DietTag));
  return inEnumOrder(
    [...classifyRecipe(recipe, categoriesOf).dietType, ...(kept as DietTag[])],
    DietTag,
  );
}

/** Every recipe classified and compared with the diet tags of its source. */
export function classifyRecipes(data: SeedData): RecipeClassificationReport[] {
  const categoriesOf = foodCategoriesOf(data);

  return data.recipes.map((recipe) => {
    const classification = classifyRecipe(recipe, categoriesOf);
    const source = recipe.dietType.filter((tag) => DERIVED_TAGS.includes(tag as DietTag));

    const contradicted = (source as DietTag[])
      .filter((tag) => !DIET_SATISFIED_BY[tag].some((by) => classification.dietType.includes(by)))
      .map((tag) => ({
        tag,
        foods: recipe.ingredients
          .filter(({ food }) => excludes(tag, categoriesOf.get(food) ?? []))
          .map(({ food }) => food),
      }));
    const untagged = classification.dietType.filter((tag) => !source.includes(tag));

    return { slug: recipe.slug, ...classification, contradicted, untagged };
  });
}

/** Lines of the report: one per recipe that differs from its source, then a summary. */
export function formatClassificationReport(reports: RecipeClassificationReport[]): string[] {
  const differing = reports.filter((r) => r.contradicted.length > 0 || r.untagged.length > 0);
  const lines = differing.map((report) => {
    const parts = [
      ...report.contradicted.map(({ tag, foods }) => `not ${tag} (${foods.join(', ')})`),
      ...report.untagged.map((tag) => `also ${tag}`),
    ];
    return `${report.slug}: ${parts.join('; ')}`;
  });
  const contradicted = reports.filter((r) => r.contradicted.length > 0).length;
  const untagged = reports.filter((r) => r.untagged.length > 0).length;

  return [
    ...lines,
    `${reports.length} recipes: ${contradicted} with a source tag the ingredients contradict, ` +
      `${untagged} with a derived tag the source misses`,
  ];
}
