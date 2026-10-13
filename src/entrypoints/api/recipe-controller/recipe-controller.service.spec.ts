import { DietTag, MealType } from '../../../common/constants';
import { NutritionService } from '../../../modules/services/nutrition/nutrition.service';
import { RecipeService } from '../../../modules/services/recipe/recipe.service';
import { createMock } from '../../../test/create-mock';
import { buildRecipe, FOOD_ID, INGREDIENT_ID, RECIPE_ID } from '../../../test/fixtures';
import { RecipeControllerService } from './recipe-controller.service';

describe('RecipeControllerService', () => {
  let recipeService: jest.Mocked<RecipeService>;
  let service: RecipeControllerService;
  const recipe = buildRecipe();
  const ingredient = { foodItemId: FOOD_ID, quantityG: 100 };

  beforeEach(() => {
    recipeService = createMock<RecipeService>();
    for (const method of [
      'getById',
      'create',
      'update',
      'addIngredient',
      'updateIngredient',
      'removeIngredient',
    ] as const) {
      recipeService[method].mockResolvedValue(recipe);
    }
    // The real calculator: it is pure and the response depends on it.
    service = new RecipeControllerService(recipeService, new NutritionService());
  });

  it('pages with filters and adds nutrition per serving', async () => {
    recipeService.getPage.mockResolvedValue({ items: [recipe], total: 1 });

    const page = await service.getPage({
      search: 'rice',
      mealType: MealType.Lunch,
      dietType: [DietTag.Vegan],
      page: 1,
      limit: 5,
    });

    expect(recipeService.getPage).toHaveBeenCalledWith(
      { search: 'rice', mealType: MealType.Lunch, dietTypes: [DietTag.Vegan] },
      { page: 1, limit: 5 },
    );
    expect(page).toMatchObject({ total: 1, page: 1, limit: 5 });
    expect(page.items[0].nutritionPerServing).toEqual({
      kcal: 130,
      proteinG: 2.7,
      fatG: 0.3,
      carbsG: 28.2,
    });
  });

  it('getById maps the recipe', async () => {
    await expect(service.getById(RECIPE_ID)).resolves.toMatchObject({
      id: RECIPE_ID,
      nutritionComplete: true,
    });
  });

  describe('getNutrition', () => {
    it('returns the full breakdown', async () => {
      const nutrition = await service.getNutrition(RECIPE_ID, {});

      expect(nutrition).toMatchObject({
        recipeId: RECIPE_ID,
        servings: 2,
        includeOptional: false,
        basis: 'ingredients_sum',
        total: { kcal: 260 },
      });
      expect(nutrition.ingredients).toHaveLength(1);
    });

    it('passes includeOptional', async () => {
      await expect(
        service.getNutrition(RECIPE_ID, { includeOptional: true }),
      ).resolves.toMatchObject({ includeOptional: true });
    });
  });

  it('create splits the ingredients from the fields', async () => {
    const data = { name: 'Rice', instructions: 'x', mealType: MealType.Lunch, servings: 2 };

    await service.create({ ...data, ingredients: [ingredient] });

    expect(recipeService.create).toHaveBeenCalledWith(data, [ingredient]);
  });

  it('update passes the optional ingredient list', async () => {
    await service.update(RECIPE_ID, { servings: 3 });
    await service.update(RECIPE_ID, { ingredients: [ingredient] });

    expect(recipeService.update).toHaveBeenNthCalledWith(1, RECIPE_ID, { servings: 3 }, undefined);
    expect(recipeService.update).toHaveBeenNthCalledWith(2, RECIPE_ID, {}, [ingredient]);
  });

  it('delete', async () => {
    await service.delete(RECIPE_ID);

    expect(recipeService.delete).toHaveBeenCalledWith(RECIPE_ID);
  });

  it('ingredient routes return the updated recipe', async () => {
    await expect(service.addIngredient(RECIPE_ID, ingredient)).resolves.toMatchObject({
      id: RECIPE_ID,
    });
    await service.updateIngredient(RECIPE_ID, INGREDIENT_ID, { quantityG: 5 });
    await service.removeIngredient(RECIPE_ID, INGREDIENT_ID);

    expect(recipeService.addIngredient).toHaveBeenCalledWith(RECIPE_ID, ingredient);
    expect(recipeService.updateIngredient).toHaveBeenCalledWith(RECIPE_ID, INGREDIENT_ID, {
      quantityG: 5,
    });
    expect(recipeService.removeIngredient).toHaveBeenCalledWith(RECIPE_ID, INGREDIENT_ID);
  });
});
