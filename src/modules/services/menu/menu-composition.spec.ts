import { Prisma } from '../../../generated/prisma/client';
import { MealType } from '../../../common/constants';
import {
  buildMenuVersion,
  buildRecipe,
  buildRecipeSnapshot,
  RECIPE_ID,
} from '../../../test/fixtures';
import { NutritionService } from '../nutrition/nutrition.service';
import {
  composeMenu,
  resolveVersion,
  ResolvedDay,
  snapshotRecipe,
  toDraft,
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

  describe('snapshotRecipe', () => {
    it('keeps the recipe, its ingredients and the nutrition per serving', () => {
      const recipe = buildRecipe();
      const nutrition = new NutritionService().calculateRecipe(recipe);

      expect(snapshotRecipe(recipe, nutrition)).toEqual(buildRecipeSnapshot());
    });
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

    it('drafts the next version: live recipes by id, deleted ones by snapshot', () => {
      expect(toDraft(version)).toEqual([
        {
          dayIndex: 0,
          date: null,
          meals: [
            { mealType: MealType.Lunch, servings: 1, recipeId: RECIPE_ID },
            { mealType: MealType.Dinner, servings: 2, recipeId: null, recipeSnapshot: soup },
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
