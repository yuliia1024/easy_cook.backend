import { DietTag, MealType, SortOrder } from '../../../common/constants';
import { NutritionService } from '../../../modules/services/nutrition/nutrition.service';
import { RecipeService } from '../../../modules/services/recipe/recipe.service';
import { createMock } from '../../../test/create-mock';
import { buildRecipe, RECIPE_ID } from '../../../test/fixtures';
import { RecipeControllerService } from './recipe-controller.service';

describe('RecipeControllerService', () => {
  let recipeService: jest.Mocked<RecipeService>;
  let service: RecipeControllerService;
  const recipe = buildRecipe();

  beforeEach(() => {
    recipeService = createMock<RecipeService>();
    recipeService.getById.mockResolvedValue(recipe);
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
      { page: 1, limit: 5, sortOrder: SortOrder.Asc },
    );
    expect(page).toMatchObject({ total: 1, page: 1, limit: 5 });
    expect(page.items[0].nutritionPerServing).toEqual({
      kcal: 130,
      proteinG: 2.7,
      fatG: 0.3,
      carbsG: 28.2,
    });
  });

  it('passes the requested sort order', async () => {
    recipeService.getPage.mockResolvedValue({ items: [], total: 0 });

    await service.getPage({ sortOrder: SortOrder.Desc });

    expect(recipeService.getPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sortOrder: SortOrder.Desc }),
    );
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
});
