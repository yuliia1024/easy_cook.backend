import { Prisma } from '../../../generated/prisma/client';
import { FoodState } from '../../../common/constants';
import { buildFoodItem, buildIngredient, buildRecipe } from '../../../test/fixtures';
import { NutritionService } from './nutrition.service';

const d = (value: number): Prisma.Decimal => new Prisma.Decimal(value);

/** Per 100 g, rounded USDA values. */
const riceDry = buildFoodItem({
  id: 'rice-dry',
  name: 'Rice, dry',
  state: FoodState.Dried,
  kcalPer100g: d(365),
  proteinG: d(7.1),
  fatG: d(0.66),
  carbsG: d(80),
});
const riceBoiled = buildFoodItem({ id: 'rice-boiled', name: 'Rice, boiled' });
const oliveOil = buildFoodItem({
  id: 'oil',
  name: 'Olive oil',
  state: FoodState.Other,
  kcalPer100g: d(884),
  proteinG: d(0),
  fatG: d(100),
  carbsG: d(0),
});
const chicken = buildFoodItem({
  id: 'chicken',
  name: 'Chicken breast, raw',
  state: FoodState.Raw,
  kcalPer100g: d(120),
  proteinG: d(22.5),
  fatG: d(2.6),
  carbsG: d(0),
});
const unknownSauce = buildFoodItem({
  id: 'sauce',
  name: 'Sauce',
  state: FoodState.Other,
  kcalPer100g: d(80),
  proteinG: null,
  fatG: d(2),
  carbsG: null,
});

describe('NutritionService', () => {
  const service = new NutritionService();

  describe('forQuantity', () => {
    it('scales per-100g values: quantity / 100 * value', () => {
      expect(service.forQuantity(chicken, 250)).toEqual({
        macros: { kcal: 300, proteinG: 56.25, fatG: 6.5, carbsG: 0 },
        missing: [],
      });
    });

    it('counts an unknown value as 0 and reports it', () => {
      expect(service.forQuantity(unknownSauce, 50)).toEqual({
        macros: { kcal: 40, proteinG: 0, fatG: 1, carbsG: 0 },
        missing: ['proteinG', 'carbsG'],
      });
    });

    it('is 0 for 0 g', () => {
      expect(service.forQuantity(oliveOil, 0).macros).toEqual({
        kcal: 0,
        proteinG: 0,
        fatG: 0,
        carbsG: 0,
      });
    });
  });

  describe('calculateIngredient', () => {
    it('returns rounded values with the food state', () => {
      const result = service.calculateIngredient(
        buildIngredient({ id: 'i1', foodItem: riceDry, quantityG: d(75) }),
      );

      expect(result).toEqual({
        ingredientId: 'i1',
        foodItemId: 'rice-dry',
        foodName: 'Rice, dry',
        state: FoodState.Dried,
        quantityG: 75,
        isOptional: false,
        counted: true,
        macros: { kcal: 273.8, proteinG: 5.3, fatG: 0.5, carbsG: 60 },
        missing: [],
      });
    });

    it('treats dry and boiled rice as different products', () => {
      const dry = service.calculateIngredient(
        buildIngredient({ foodItem: riceDry, quantityG: d(100) }),
      );
      const boiled = service.calculateIngredient(
        buildIngredient({ foodItem: riceBoiled, quantityG: d(100) }),
      );

      expect(dry.macros.kcal).toBe(365);
      expect(boiled.macros.kcal).toBe(130);
      expect(boiled.state).toBe(FoodState.Boiled);
    });
  });

  describe('calculateRecipe', () => {
    // Control example: 300 g raw chicken + 150 g dry rice + 15 g olive oil, 2 servings.
    // kcal    = 3 * 120 + 1.5 * 365 + 0.15 * 884   = 360 + 547.5 + 132.6 = 1040.1
    // protein = 3 * 22.5 + 1.5 * 7.1 + 0           = 67.5 + 10.65       = 78.15
    // fat     = 3 * 2.6 + 1.5 * 0.66 + 0.15 * 100  = 7.8 + 0.99 + 15    = 23.79
    // carbs   = 0 + 1.5 * 80 + 0                   = 120
    const recipe = buildRecipe({
      servings: 2,
      ingredients: [
        buildIngredient({ id: 'a', foodItem: chicken, quantityG: d(300) }),
        buildIngredient({ id: 'b', foodItem: riceDry, quantityG: d(150) }),
        buildIngredient({ id: 'c', foodItem: oliveOil, quantityG: d(15) }),
      ],
    });

    it('sums the ingredients', () => {
      const result = service.calculateRecipe(recipe);

      expect(result.total).toEqual({ kcal: 1040.1, proteinG: 78.2, fatG: 23.8, carbsG: 120 });
      expect(result.basis).toBe('ingredients_sum');
      expect(result.complete).toBe(true);
      expect(result.ingredients.map((i) => i.ingredientId)).toEqual(['a', 'b', 'c']);
    });

    it('divides the unrounded total by servings', () => {
      // 78.15 / 2 = 39.075 -> 39.1; 23.79 / 2 = 11.895 -> 11.9
      expect(service.calculateRecipe(recipe).perServing).toEqual({
        kcal: 520.1,
        proteinG: 39.1,
        fatG: 11.9,
        carbsG: 60,
      });
    });

    describe('optional ingredients', () => {
      const withOptional = buildRecipe({
        servings: 1,
        ingredients: [
          buildIngredient({ id: 'a', foodItem: chicken, quantityG: d(100) }),
          buildIngredient({ id: 'b', foodItem: oliveOil, quantityG: d(10), isOptional: true }),
        ],
      });

      it('are left out by default but still listed', () => {
        const result = service.calculateRecipe(withOptional);

        expect(result.total.kcal).toBe(120);
        expect(result.includeOptional).toBe(false);
        expect(result.ingredients[1]).toMatchObject({ counted: false, macros: { kcal: 88.4 } });
      });

      it('are counted on request', () => {
        const result = service.calculateRecipe(withOptional, { includeOptional: true });

        expect(result.total.kcal).toBe(208.4);
        expect(result.ingredients[1].counted).toBe(true);
      });
    });

    describe('missing values', () => {
      it('mark the result incomplete', () => {
        const result = service.calculateRecipe(
          buildRecipe({
            ingredients: [
              buildIngredient({ id: 'a', foodItem: chicken, quantityG: d(100) }),
              buildIngredient({ id: 'b', foodItem: unknownSauce, quantityG: d(100) }),
            ],
          }),
        );

        expect(result.complete).toBe(false);
        expect(result.total).toEqual({ kcal: 200, proteinG: 22.5, fatG: 4.6, carbsG: 0 });
        expect(result.ingredients[1].missing).toEqual(['proteinG', 'carbsG']);
      });

      it('of an optional ingredient that is left out do not', () => {
        const result = service.calculateRecipe(
          buildRecipe({
            ingredients: [
              buildIngredient({ id: 'a', foodItem: chicken, quantityG: d(100) }),
              buildIngredient({
                id: 'b',
                foodItem: unknownSauce,
                quantityG: d(100),
                isOptional: true,
              }),
            ],
          }),
        );

        expect(result.complete).toBe(true);
      });
    });

    it('returns zeros for a recipe without ingredients', () => {
      const result = service.calculateRecipe(buildRecipe({ ingredients: [] }));

      expect(result.total).toEqual({ kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 });
      expect(result.complete).toBe(true);
    });

    it('never divides by zero servings', () => {
      const result = service.calculateRecipe({ ...recipe, servings: 0 });

      expect(result.perServing).toEqual(result.total);
    });
  });
});
