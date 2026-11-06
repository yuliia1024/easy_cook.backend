import { buildFoodItem, buildRecipe, FOOD_ID } from '../../../test/fixtures';
import { NutritionService } from '../nutrition/nutrition.service';
import {
  toFoodNutrition,
  toNutritionCalculation,
  toRecipeDetails,
  toRecipeSummary,
} from './chat-tool-results';

describe('chat tool results', () => {
  const nutritionService = new NutritionService();
  const recipe = buildRecipe();
  const nutrition = nutritionService.calculateRecipe(recipe);
  const rules = { diets: [], allergies: [], excludedIngredients: [], dislikedFoods: [] };

  it('summarizes a recipe with a serving and whether the rules allow it', () => {
    expect(toRecipeSummary(recipe, nutrition, rules)).toMatchObject({
      id: recipe.id,
      diets: recipe.dietType,
      perServing: nutrition.perServing,
      complete: true,
      fitsProfile: true,
    });
    expect(
      toRecipeSummary(recipe, nutrition, { ...rules, diets: ['high_protein'] }).fitsProfile,
    ).toBe(false);
    expect(toRecipeSummary(recipe, nutrition, null).fitsProfile).toBeNull();
  });

  it('lists the ingredients of a recipe in grams', () => {
    expect(toRecipeDetails(recipe, nutrition, null).ingredients).toEqual([
      {
        foodId: FOOD_ID,
        foodName: 'White rice, boiled',
        state: 'boiled',
        quantityG: 200,
        isOptional: false,
      },
    ]);
  });

  it('keeps unknown food values null for 100 g and for the quantity', () => {
    const result = toFoodNutrition(buildFoodItem({ proteinG: null }), 50, nutritionService);

    expect(result.per100g.proteinG).toBeNull();
    expect(result.forQuantity).toEqual({ kcal: 65, proteinG: null, fatG: 0.2, carbsG: 14.1 });
  });

  it('gives a calculation per food with the nutrients it misses', () => {
    expect(toNutritionCalculation(nutrition).items).toEqual([
      expect.objectContaining({ foodId: FOOD_ID, quantityG: 200, missing: [] }),
    ]);
  });
});
