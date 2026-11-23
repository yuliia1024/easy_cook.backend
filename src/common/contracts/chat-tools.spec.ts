import {
  CALCULATE_NUTRITION_MAX_ITEMS,
  CHAT_TOOL_MAX_QUANTITY_G,
  INTENT_REQUEST_MAX_LENGTH,
  SEARCH_RECIPES_MAX_RESULTS,
  SEARCH_RECIPES_QUERY_MAX_LENGTH,
} from '../constants';
import {
  CalculateNutritionInputSchema,
  GetFoodNutritionInputSchema,
  GetRecipeDetailsInputSchema,
  PlanMenuInputSchema,
  ReviseMenuInputSchema,
  SearchRecipesInputSchema,
} from './chat-tools';

const FOOD_ID = '22222222-2222-4222-8222-222222222222';

describe('chat tool contracts', () => {
  describe('SearchRecipesInputSchema', () => {
    const input = {
      query: null,
      mealType: null,
      diet: null,
      maxKcalPerServing: null,
      maxPrepTimeMinutes: null,
      limit: null,
    };

    it('accepts every filter as null or a known value, and trims the query', () => {
      expect(SearchRecipesInputSchema.parse(input)).toEqual(input);
      expect(
        SearchRecipesInputSchema.parse({
          query: '  soup ',
          mealType: 'lunch',
          diet: 'vegan',
          maxKcalPerServing: 500,
          maxPrepTimeMinutes: 30,
          limit: SEARCH_RECIPES_MAX_RESULTS,
        }),
      ).toMatchObject({ query: 'soup' });
    });

    it.each([
      ['a missing field', { query: null }],
      ['an unknown meal', { ...input, mealType: 'brunch' }],
      ['an unknown diet', { ...input, diet: 'paleo' }],
      ['a blank query', { ...input, query: '   ' }],
      ['a long query', { ...input, query: 'a'.repeat(SEARCH_RECIPES_QUERY_MAX_LENGTH + 1) }],
      ['no time', { ...input, maxPrepTimeMinutes: 0 }],
      ['too many results', { ...input, limit: SEARCH_RECIPES_MAX_RESULTS + 1 }],
      ['no calories', { ...input, maxKcalPerServing: 0 }],
    ])('rejects %s', (_case, value) => {
      expect(SearchRecipesInputSchema.safeParse(value).success).toBe(false);
    });
  });

  it('GetRecipeDetailsInputSchema takes a uuid only', () => {
    expect(GetRecipeDetailsInputSchema.safeParse({ recipeId: FOOD_ID }).success).toBe(true);
    expect(GetRecipeDetailsInputSchema.safeParse({ recipeId: 'Rice bowl' }).success).toBe(false);
  });

  it('GetFoodNutritionInputSchema takes a query and grams within the limit or null', () => {
    expect(GetFoodNutritionInputSchema.safeParse({ query: 'rice', quantityG: null }).success).toBe(
      true,
    );
    expect(
      GetFoodNutritionInputSchema.safeParse({
        query: 'rice',
        quantityG: CHAT_TOOL_MAX_QUANTITY_G + 1,
      }).success,
    ).toBe(false);
    expect(GetFoodNutritionInputSchema.safeParse({ query: 'rice', quantityG: -5 }).success).toBe(
      false,
    );
  });

  describe('CalculateNutritionInputSchema', () => {
    const item = { foodId: FOOD_ID, quantityG: 100 };

    it('accepts foods by id with grams and the servings or null', () => {
      expect(
        CalculateNutritionInputSchema.safeParse({ items: [item], servings: null }).success,
      ).toBe(true);
    });

    it.each([
      ['no items', { items: [], servings: 1 }],
      [
        'too many items',
        { items: Array(CALCULATE_NUTRITION_MAX_ITEMS + 1).fill(item), servings: 1 },
      ],
      ['a food name for an id', { items: [{ ...item, foodId: 'rice' }], servings: 1 }],
      ['0 servings', { items: [item], servings: 0 }],
      ['a fraction of servings', { items: [item], servings: 1.5 }],
    ])('rejects %s', (_case, value) => {
      expect(CalculateNutritionInputSchema.safeParse(value).success).toBe(false);
    });
  });

  describe('menu tools', () => {
    const menuRequest = {
      days: 2,
      mealTypes: ['lunch'],
      caloriesKcal: null,
      diets: [],
      excludedIngredients: [],
      dislikedFoods: [],
      wishes: null,
    };

    it('PlanMenuInputSchema takes the request and its fields as the classifier gives them', () => {
      expect(PlanMenuInputSchema.safeParse({ request: 'Plan a menu.', menuRequest }).success).toBe(
        true,
      );
      expect(
        PlanMenuInputSchema.safeParse({
          request: 'a'.repeat(INTENT_REQUEST_MAX_LENGTH + 1),
          menuRequest,
        }).success,
      ).toBe(false);
      expect(
        PlanMenuInputSchema.safeParse({
          request: 'Plan a menu.',
          menuRequest: { ...menuRequest, mealTypes: ['brunch'] },
        }).success,
      ).toBe(false);
    });

    it('ReviseMenuInputSchema needs at least one target', () => {
      const input = { request: 'Another lunch.', menuRequest };
      const target = { scope: 'meal', dayIndex: 0, mealType: 'lunch' };

      expect(ReviseMenuInputSchema.safeParse({ ...input, targets: [target] }).success).toBe(true);
      expect(ReviseMenuInputSchema.safeParse({ ...input, targets: [] }).success).toBe(false);
      expect(
        ReviseMenuInputSchema.safeParse({ ...input, targets: [{ ...target, dayIndex: -1 }] })
          .success,
      ).toBe(false);
    });
  });
});
