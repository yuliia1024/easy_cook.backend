import { SortOrder } from '../../../common/constants';
import { RecipeNotFoundException } from '../../../common/exceptions';
import { PreferenceRules } from '../../../common/types';
import { createMock } from '../../../test/create-mock';
import { buildFoodItem, buildIngredient, buildRecipe, RECIPE_ID } from '../../../test/fixtures';
import { RecipeRepository } from '../../data-access/recipe/recipe.repository';
import { RecipeService } from './recipe.service';

describe('RecipeService', () => {
  let recipeRepository: jest.Mocked<RecipeRepository>;
  let service: RecipeService;
  /** 200 g of boiled rice (130 kcal / 100 g), 2 servings. */
  const recipe = buildRecipe();

  beforeEach(() => {
    recipeRepository = createMock<RecipeRepository>();
    recipeRepository.findById.mockResolvedValue(recipe);
    service = new RecipeService(recipeRepository);
  });

  it('getPage trims the search', async () => {
    const page = { page: 1, limit: 20, sortOrder: SortOrder.Asc };

    await service.getPage({ search: ' soup ', dietTypes: ['vegan'] }, page);

    expect(recipeRepository.findPage).toHaveBeenCalledWith(
      { search: 'soup', dietTypes: ['vegan'] },
      page,
    );
  });

  describe('getAllowed', () => {
    const rules: PreferenceRules = {
      diets: ['vegetarian'],
      allergies: [],
      excludedIngredients: [],
      dislikedFoods: ['rice'],
    };
    const rice = buildRecipe({
      id: 'rice',
      ingredients: [buildIngredient({ foodItem: buildFoodItem({ name: 'Rice, boiled' }) })],
    });
    const peanuts = buildRecipe({
      id: 'peanuts',
      ingredients: [
        buildIngredient({
          isOptional: true,
          foodItem: buildFoodItem({ name: 'Арахіс', nameEn: 'Peanuts' }),
        }),
      ],
    });

    beforeEach(() => {
      recipeRepository.findAll.mockResolvedValue([rice, peanuts]);
    });

    it('searches by the tags that satisfy each diet and keeps disliked foods', async () => {
      await expect(service.getAllowed(rules)).resolves.toEqual([rice, peanuts]);
      expect(recipeRepository.findAll).toHaveBeenCalledWith({
        dietTypeGroups: [['vegetarian', 'vegan']],
      });
    });

    it('drops an allergen in an optional ingredient, by its English name', async () => {
      await expect(service.getAllowed({ ...rules, allergies: ['peanut'] })).resolves.toEqual([
        rice,
      ]);
    });

    it('drops a recipe whose allergens the allergy names', async () => {
      const cheesy = buildRecipe({ id: 'cheesy', allergens: ['milk'] });
      recipeRepository.findAll.mockResolvedValue([rice, cheesy]);

      await expect(service.getAllowed({ ...rules, allergies: ['dairy'] })).resolves.toEqual([rice]);
    });

    it('drops an excluded ingredient', async () => {
      await expect(
        service.getAllowed({ ...rules, excludedIngredients: ['rice'] }),
      ).resolves.toEqual([peanuts]);
    });
  });

  describe('getAll', () => {
    it('returns every recipe, unfiltered', async () => {
      const recipes = [buildRecipe()];
      recipeRepository.findAll.mockResolvedValue(recipes);

      await expect(service.getAll()).resolves.toBe(recipes);
      expect(recipeRepository.findAll).toHaveBeenCalledWith({});
    });
  });

  describe('getById', () => {
    it('returns the recipe with ingredients', async () => {
      await expect(service.getById(RECIPE_ID)).resolves.toBe(recipe);
    });

    it('fails for an unknown id', async () => {
      recipeRepository.findById.mockResolvedValue(null);

      await expect(service.getById(RECIPE_ID)).rejects.toBeInstanceOf(RecipeNotFoundException);
    });
  });
});
