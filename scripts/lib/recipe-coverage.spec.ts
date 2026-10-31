import { DietTag, FoodCategory, MealType } from '../../src/common/constants';
import { FoodCategories } from './classify-recipes';
import {
  CoverageReport,
  formatCoverageReport,
  MIN_RECIPES_PER_MEAL,
  recipeCoverage,
} from './recipe-coverage';
import { SeedRecipe } from './seed-data';

describe('recipe coverage', () => {
  const categoriesOf: FoodCategories = new Map([
    ['rice', [FoodCategory.Grain]],
    ['pasta', [FoodCategory.GlutenGrain]],
    ['cheese', [FoodCategory.Dairy]],
    ['salmon', [FoodCategory.Fish]],
    ['chicken', [FoodCategory.Poultry]],
  ]);
  let index = 0;
  const recipe = (mealType: MealType, foods: string[]): SeedRecipe => ({
    slug: `dish-${index++}`,
    name: 'Dish',
    instructions: 'Cook',
    mealType,
    dietType: [],
    servings: 1,
    ingredients: foods.map((food) => ({ food, quantityG: 100 })),
  });
  const times = (count: number, make: () => SeedRecipe): SeedRecipe[] =>
    Array.from({ length: count }, make);
  const countsOf = (report: CoverageReport, diet: DietTag | null): Record<MealType, number> =>
    report.rows.find((row) => row.diet === diet)!.counts;

  describe('recipeCoverage', () => {
    it('counts the recipes of every meal type, all of them and per derived diet', () => {
      const report = recipeCoverage(
        [
          recipe(MealType.Breakfast, ['rice']),
          recipe(MealType.Breakfast, ['pasta', 'cheese']),
          recipe(MealType.Dinner, ['salmon', 'rice']),
          recipe(MealType.Snack, ['chicken']),
        ],
        categoriesOf,
      );

      expect(report.rows.map((row) => row.diet)).toEqual([
        null,
        DietTag.Vegan,
        DietTag.Vegetarian,
        DietTag.Pescatarian,
        DietTag.GlutenFree,
        DietTag.DairyFree,
      ]);
      expect(countsOf(report, null)).toEqual({ breakfast: 2, lunch: 0, dinner: 1, snack: 1 });
      expect(countsOf(report, DietTag.Vegan)).toEqual({
        breakfast: 1,
        lunch: 0,
        dinner: 0,
        snack: 0,
      });
      expect(countsOf(report, DietTag.Pescatarian)).toEqual({
        breakfast: 2,
        lunch: 0,
        dinner: 1,
        snack: 0,
      });
      expect(countsOf(report, DietTag.GlutenFree)).toEqual({
        breakfast: 1,
        lunch: 0,
        dinner: 1,
        snack: 1,
      });
      expect(countsOf(report, DietTag.DairyFree)).toEqual({
        breakfast: 1,
        lunch: 0,
        dinner: 1,
        snack: 1,
      });
    });

    it('counts a vegan recipe for vegetarian and pescatarian too', () => {
      const report = recipeCoverage([recipe(MealType.Lunch, ['rice'])], categoriesOf);

      expect(countsOf(report, DietTag.Vegetarian).lunch).toBe(1);
      expect(countsOf(report, DietTag.Pescatarian).lunch).toBe(1);
    });

    it('ignores high_protein and low_carb, which are not derived', () => {
      const report = recipeCoverage([], categoriesOf);

      expect(report.rows.map((row) => row.diet)).not.toContain(DietTag.HighProtein);
      expect(report.shortfalls.map((s) => s.diet)).not.toContain(DietTag.LowCarb);
    });

    it('reports every diet and covered meal type below the minimum, snacks left out', () => {
      const enough = (mealType: MealType, foods: string[]): SeedRecipe[] =>
        times(MIN_RECIPES_PER_MEAL, () => recipe(mealType, foods));
      const report = recipeCoverage(
        [
          ...enough(MealType.Breakfast, ['rice']),
          ...enough(MealType.Lunch, ['rice']),
          ...times(MIN_RECIPES_PER_MEAL - 1, () => recipe(MealType.Dinner, ['rice'])),
          ...enough(MealType.Dinner, ['salmon', 'pasta']),
        ],
        categoriesOf,
      );

      expect(report.shortfalls).toEqual([
        { diet: DietTag.Vegan, mealType: MealType.Dinner, count: MIN_RECIPES_PER_MEAL - 1 },
        { diet: DietTag.Vegetarian, mealType: MealType.Dinner, count: MIN_RECIPES_PER_MEAL - 1 },
        { diet: DietTag.GlutenFree, mealType: MealType.Dinner, count: MIN_RECIPES_PER_MEAL - 1 },
      ]);
    });

    it('has no shortfalls when every diet has enough of every covered meal type', () => {
      const recipes = [MealType.Breakfast, MealType.Lunch, MealType.Dinner].flatMap((mealType) =>
        times(MIN_RECIPES_PER_MEAL, () => recipe(mealType, ['rice'])),
      );

      expect(recipeCoverage(recipes, categoriesOf).shortfalls).toEqual([]);
    });

    it('throws on a food without categories', () => {
      expect(() => recipeCoverage([recipe(MealType.Lunch, ['tofu'])], categoriesOf)).toThrow(
        'food tofu has no categories',
      );
    });
  });

  describe('formatCoverageReport', () => {
    const counts = (breakfast: number, lunch: number, dinner: number, snack: number) => ({
      breakfast,
      lunch,
      dinner,
      snack,
    });

    it('prints the table and the summary when nothing is short', () => {
      expect(
        formatCoverageReport({
          rows: [
            { diet: null, counts: counts(120, 30, 30, 5) },
            { diet: DietTag.Vegan, counts: counts(14, 15, 16, 0) },
          ],
          shortfalls: [],
        }),
      ).toEqual([
        'diet   breakfast  lunch  dinner  snack',
        'all          120     30      30      5',
        'vegan         14     15      16      0',
        '',
        'Every diet has at least 14 per breakfast, lunch, dinner',
      ]);
    });

    it('lists the shortfalls with how many recipes are missing', () => {
      const lines = formatCoverageReport({
        rows: [{ diet: DietTag.Vegan, counts: counts(5, 14, 14, 0) }],
        shortfalls: [{ diet: DietTag.Vegan, mealType: MealType.Breakfast, count: 5 }],
      });

      expect(lines.slice(-2)).toEqual([
        'short vegan breakfast: 5, needs 9 more',
        '1 diet and meal type pairs below 14 per breakfast, lunch, dinner',
      ]);
    });
  });
});
