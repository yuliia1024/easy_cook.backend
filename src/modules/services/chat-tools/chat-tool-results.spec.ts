import { CHAT_TOOL_TEXT_MAX_LENGTH } from '../../../common/constants';
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

  it('cuts a long description or instructions to CHAT_TOOL_TEXT_MAX_LENGTH', () => {
    const long = 'x'.repeat(CHAT_TOOL_TEXT_MAX_LENGTH + 10);
    const details = toRecipeDetails(
      { ...recipe, description: long, instructions: long },
      nutrition,
      null,
    );

    expect(details.description).toHaveLength(CHAT_TOOL_TEXT_MAX_LENGTH);
    expect(details.description?.endsWith('…')).toBe(true);
    expect(details.instructions).toHaveLength(CHAT_TOOL_TEXT_MAX_LENGTH);
  });

  it('keeps a short text and a missing description as they are', () => {
    const details = toRecipeDetails(
      { ...recipe, description: null, instructions: 'Boil.' },
      nutrition,
      null,
    );

    expect(details.description).toBeNull();
    expect(details.instructions).toBe('Boil.');
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
