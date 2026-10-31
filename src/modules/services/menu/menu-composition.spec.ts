import { Prisma } from '../../../generated/prisma/client';
import { MealType } from '../../../common/constants';
import { ResolvedDay } from '../../../common/types';
import {
  buildMenuVersion,
  buildRecipe,
  buildRecipeSnapshot,
  RECIPE_ID,
} from '../../../test/fixtures';
import { NutritionService } from '../nutrition/nutrition.service';
import {
  composeMenu,
  fitServings,
  resolveVersion,
  snapshotRecipe,
  toIsoDate,
} from './menu-composition';

describe('menu composition', () => {
  const rice = buildRecipeSnapshot();
  /** 300 kcal per serving, protein unknown somewhere. */
  const soup = buildRecipeSnapshot({
    id: 'soup',
    name: 'Soup',
    perServing: { kcal: 300, proteinG: 10, fatG: 5, carbsG: 50 },
    complete: false,
  });

  it('snapshotRecipe keeps the recipe, its allergens, its foods and its nutrition per serving', () => {
    const recipe = buildRecipe({ allergens: ['gluten'] });

    expect(snapshotRecipe(recipe, new NutritionService().calculateRecipe(recipe))).toEqual(
      buildRecipeSnapshot({ allergens: ['gluten'] }),
    );
  });

  describe('composeMenu', () => {
    const days: ResolvedDay[] = [
      {
        dayIndex: 0,
        date: new Date('2026-10-20T00:00:00Z'),
        meals: [
          { mealType: MealType.Lunch, servings: 2, recipeId: RECIPE_ID, recipe: rice },
          { mealType: MealType.Dinner, servings: 0.5, recipeId: null, recipe: soup },
        ],
      },
      {
        dayIndex: 1,
        date: null,
        meals: [{ mealType: MealType.Lunch, servings: 1, recipeId: RECIPE_ID, recipe: rice }],
      },
    ];

    it('scales every meal by its servings and sums the days', () => {
      const { days: composed } = composeMenu(days);

      expect(composed[0]).toEqual({
        dayIndex: 0,
        date: '2026-10-20',
        meals: [
          {
            position: 0,
            mealType: MealType.Lunch,
            recipeId: RECIPE_ID,
            recipeName: 'Rice with vegetables',
            servings: 2,
            nutrition: { kcal: 260, proteinG: 5.4, fatG: 0.6, carbsG: 56.4 },
            complete: true,
          },
          {
            position: 1,
            mealType: MealType.Dinner,
            recipeId: null,
            recipeName: 'Soup',
            servings: 0.5,
            nutrition: { kcal: 150, proteinG: 5, fatG: 2.5, carbsG: 25 },
            complete: false,
          },
        ],
        totals: { kcal: 410, proteinG: 10.4, fatG: 3.1, carbsG: 81.4 },
        complete: false,
      });
      expect(composed[1]).toMatchObject({ date: null, totals: { kcal: 130 }, complete: true });
    });

    it('averages the days', () => {
      expect(composeMenu(days).dailyAverage).toEqual({
        kcal: 270,
        proteinG: 6.6,
        fatG: 1.7,
        carbsG: 54.8,
      });
    });

    it('handles an empty menu', () => {
      expect(composeMenu([])).toEqual({
        days: [],
        dailyAverage: { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
      });
    });
  });

  it('formats a date column as YYYY-MM-DD', () => {
    expect(toIsoDate(new Date('2026-10-20T00:00:00Z'))).toBe('2026-10-20');
    expect(toIsoDate(null)).toBeNull();
  });

  describe('fitServings', () => {
    /** One day of one serving of recipes with these kcal per serving. */
    const dayOf = (...kcal: number[]): ResolvedDay[] => [
      {
        dayIndex: 0,
        date: null,
        meals: kcal.map((value, i) => ({
          mealType: MealType.Lunch,
          servings: 1,
          recipeId: `r${i}`,
          recipe: buildRecipeSnapshot({
            id: `r${i}`,
            perServing: { kcal: value, proteinG: 0, fatG: 0, carbsG: 0 },
          }),
        })),
      },
    ];
    const servingsOf = (days: ResolvedDay[]): number[] =>
      days[0].meals.map(({ servings }) => servings);

    it('keeps the servings of a day close enough to the calories', () => {
      const days = dayOf(500, 700, 200, 550);

      expect(fitServings(days, 2000)).toEqual(days);
    });

    it('gives every meal the same servings when that is enough', () => {
      expect(servingsOf(fitServings(dayOf(400, 400, 400, 400), 2000))).toEqual([
        1.25, 1.25, 1.25, 1.25,
      ]);
      expect(servingsOf(fitServings(dayOf(1000, 1000, 1000, 1000), 2000))).toEqual([
        0.5, 0.5, 0.5, 0.5,
      ]);
    });

    it('then steps the meal that brings the day closest', () => {
      // 1700 kcal is 1.12 x short of 1900, rounded to 1; a step of the 600 kcal meal gives 1850.
      expect(servingsOf(fitServings(dayOf(500, 400, 200, 600), 1900))).toEqual([1, 1, 1, 1.25]);
    });

    it('stays within the servings a meal can have', () => {
      expect(servingsOf(fitServings(dayOf(100, 100), 2000))).toEqual([2, 2]);
      expect(servingsOf(fitServings(dayOf(1000, 1000), 200))).toEqual([0.5, 0.5]);
    });

    it('leaves the days it gets as they are', () => {
      const days = dayOf(400, 400, 400, 400);

      fitServings(days, 2000);

      expect(servingsOf(days)).toEqual([1, 1, 1, 1]);
    });
  });

  describe('saved versions', () => {
    const version = buildMenuVersion();
    version.days[0].meals.push({
      ...version.days[0].meals[0],
      id: 'deleted',
      position: 1,
      mealType: MealType.Dinner,
      recipeId: null,
      servings: new Prisma.Decimal(2),
      recipeSnapshot: soup as unknown as Prisma.JsonObject,
    });

    it('resolves the meals to their snapshots', () => {
      expect(resolveVersion(version)).toEqual([
        {
          dayIndex: 0,
          date: null,
          meals: [
            { mealType: MealType.Lunch, servings: 1, recipeId: RECIPE_ID, recipe: rice },
            { mealType: MealType.Dinner, servings: 2, recipeId: null, recipe: soup },
          ],
        },
      ]);
    });

    it('fails loudly on a corrupt meal type', () => {
      const broken = buildMenuVersion();
      broken.days[0].meals[0].mealType = 'brunch';

      expect(() => resolveVersion(broken)).toThrow('Unknown meal type "brunch"');
    });
  });
});
