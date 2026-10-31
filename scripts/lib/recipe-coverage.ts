import { DIET_SATISFIED_BY, DietTag, MealType } from '../../src/common/constants';
import { DERIVED_TAGS, FoodCategories, seedDietType } from './classify-recipes';
import { SeedRecipe } from './seed-data';

/** The meals a 7-day menu must fill without repeating a recipe. */
export const COVERED_MEAL_TYPES: readonly MealType[] = [
  MealType.Breakfast,
  MealType.Lunch,
  MealType.Dinner,
];

/** Recipes a diet needs per covered meal type: two weeks of distinct ones. */
export const MIN_RECIPES_PER_MEAL = 14;

export interface CoverageRow {
  /** Null for every recipe, whatever its diet. */
  diet: DietTag | null;
  counts: Record<MealType, number>;
}

export interface CoverageShortfall {
  diet: DietTag;
  mealType: MealType;
  count: number;
}

export interface CoverageReport {
  rows: CoverageRow[];
  /** The diet and meal type pairs below `MIN_RECIPES_PER_MEAL`; empty when covered. */
  shortfalls: CoverageShortfall[];
}

const emptyCounts = (): Record<MealType, number> =>
  Object.fromEntries(Object.values(MealType).map((mealType) => [mealType, 0])) as Record<
    MealType,
    number
  >;

/**
 * Recipes per meal type for every diet derived from the food categories. A recipe counts for a
 * diet when its derived tags satisfy it (a vegan recipe counts for vegetarian too).
 */
export function recipeCoverage(
  recipes: SeedRecipe[],
  categoriesOf: FoodCategories,
): CoverageReport {
  const rows: CoverageRow[] = [null, ...DERIVED_TAGS].map((diet) => ({
    diet,
    counts: emptyCounts(),
  }));

  for (const recipe of recipes) {
    const tags = seedDietType(recipe, categoriesOf);
    const mealType = recipe.mealType as MealType;
    for (const row of rows) {
      if (row.diet === null || DIET_SATISFIED_BY[row.diet].some((tag) => tags.includes(tag))) {
        row.counts[mealType] += 1;
      }
    }
  }

  const shortfalls = rows.flatMap(({ diet, counts }) =>
    diet === null
      ? []
      : COVERED_MEAL_TYPES.filter((mealType) => counts[mealType] < MIN_RECIPES_PER_MEAL).map(
          (mealType) => ({ diet, mealType, count: counts[mealType] }),
        ),
  );

  return { rows, shortfalls };
}

/** The report as a table (diet x meal type) followed by the shortfalls or a summary line. */
export function formatCoverageReport({ rows, shortfalls }: CoverageReport): string[] {
  const mealTypes = Object.values(MealType);
  const header = ['diet', ...mealTypes];
  const body = rows.map(({ diet, counts }) => [
    diet ?? 'all',
    ...mealTypes.map((mealType) => String(counts[mealType])),
  ]);
  const widths = header.map((_, i) => Math.max(...[header, ...body].map((row) => row[i].length)));
  const line = (cells: string[]): string =>
    cells
      .map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i])))
      .join('  ');

  const required = `${MIN_RECIPES_PER_MEAL} per ${COVERED_MEAL_TYPES.join(', ')}`;
  return [
    line(header),
    ...body.map(line),
    '',
    ...(shortfalls.length === 0
      ? [`Every diet has at least ${required}`]
      : [
          ...shortfalls.map(
            ({ diet, mealType, count }) =>
              `short ${diet} ${mealType}: ${count}, needs ${MIN_RECIPES_PER_MEAL - count} more`,
          ),
          `${shortfalls.length} diet and meal type pairs below ${required}`,
        ]),
  ];
}
