import { MealType, RecipeSource } from '../../../common/constants';
import {
  FoodItemsNotFoundBadRequestException,
  RecipeIngredientNotFoundException,
  RecipeNotFoundException,
  RecipeSourceConflictException,
} from '../../../common/exceptions';
import { createMock } from '../../../test/create-mock';
import { buildRecipe, FOOD_ID, INGREDIENT_ID, RECIPE_ID } from '../../../test/fixtures';
import { RecipeIngredientRepository } from '../../data-access/recipe-ingredient/recipe-ingredient.repository';
import { RecipeRepository } from '../../data-access/recipe/recipe.repository';
import { FoodItemService } from '../food-item/food-item.service';
import { RecipeService } from './recipe.service';

describe('RecipeService', () => {
  let recipeRepository: jest.Mocked<RecipeRepository>;
  let ingredientRepository: jest.Mocked<RecipeIngredientRepository>;
  let foodItemService: jest.Mocked<FoodItemService>;
  let service: RecipeService;
  const recipe = buildRecipe();
  const data = {
    name: 'Суп',
    instructions: 'Зварити',
    mealType: MealType.Lunch,
    servings: 4,
  };
  const ingredients = [{ foodItemId: FOOD_ID, quantityG: 200 }];

  beforeEach(() => {
    recipeRepository = createMock<RecipeRepository>();
    recipeRepository.findById.mockResolvedValue(recipe);
    recipeRepository.findBySource.mockResolvedValue(null);
    ingredientRepository = createMock<RecipeIngredientRepository>();
    ingredientRepository.findOne.mockResolvedValue(recipe.ingredients[0]);
    foodItemService = createMock<FoodItemService>();
    service = new RecipeService(recipeRepository, ingredientRepository, foodItemService);
  });

  it('getPage trims the search', async () => {
    const page = { page: 1, limit: 20 };

    await service.getPage({ search: ' soup ', dietTypes: ['vegan'] }, page);

    expect(recipeRepository.findPage).toHaveBeenCalledWith(
      { search: 'soup', dietTypes: ['vegan'] },
      page,
    );
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

  describe('create', () => {
    it('checks the foods and defaults the source to manual', async () => {
      await service.create(data, ingredients);

      expect(foodItemService.assertExist).toHaveBeenCalledWith([FOOD_ID]);
      expect(recipeRepository.create).toHaveBeenCalledWith(
        { ...data, source: RecipeSource.Manual },
        ingredients,
      );
    });

    it('refuses unknown foods', async () => {
      foodItemService.assertExist.mockRejectedValue(
        new FoodItemsNotFoundBadRequestException(['x']),
      );

      await expect(service.create(data, ingredients)).rejects.toBeInstanceOf(
        FoodItemsNotFoundBadRequestException,
      );
      expect(recipeRepository.create).not.toHaveBeenCalled();
    });

    it('refuses a taken source id', async () => {
      recipeRepository.findBySource.mockResolvedValue({ id: 'other' });

      await expect(
        service.create({ ...data, source: RecipeSource.Seed, sourceId: 'soup' }, ingredients),
      ).rejects.toBeInstanceOf(RecipeSourceConflictException);
    });
  });

  describe('update', () => {
    it('changes fields only', async () => {
      await service.update(RECIPE_ID, { servings: 3 });

      expect(foodItemService.assertExist).not.toHaveBeenCalled();
      expect(recipeRepository.update).toHaveBeenCalledWith(RECIPE_ID, { servings: 3 }, undefined);
    });

    it('checks the foods of a new ingredient list', async () => {
      await service.update(RECIPE_ID, {}, ingredients);

      expect(foodItemService.assertExist).toHaveBeenCalledWith([FOOD_ID]);
      expect(recipeRepository.update).toHaveBeenCalledWith(RECIPE_ID, {}, ingredients);
    });

    it('checks a changed source id', async () => {
      recipeRepository.findBySource.mockResolvedValue({ id: 'other' });

      await expect(service.update(RECIPE_ID, { sourceId: 'taken' })).rejects.toBeInstanceOf(
        RecipeSourceConflictException,
      );
    });

    it('fails for an unknown recipe', async () => {
      recipeRepository.findById.mockResolvedValue(null);

      await expect(service.update(RECIPE_ID, {})).rejects.toBeInstanceOf(RecipeNotFoundException);
    });
  });

  describe('delete', () => {
    it('deletes an existing recipe', async () => {
      await service.delete(RECIPE_ID);

      expect(recipeRepository.delete).toHaveBeenCalledWith(RECIPE_ID);
    });

    it('fails for an unknown recipe', async () => {
      recipeRepository.findById.mockResolvedValue(null);

      await expect(service.delete(RECIPE_ID)).rejects.toBeInstanceOf(RecipeNotFoundException);
      expect(recipeRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('ingredients', () => {
    it('adds one after checking the food and returns the recipe', async () => {
      await expect(service.addIngredient(RECIPE_ID, ingredients[0])).resolves.toBe(recipe);

      expect(foodItemService.assertExist).toHaveBeenCalledWith([FOOD_ID]);
      expect(ingredientRepository.create).toHaveBeenCalledWith(RECIPE_ID, ingredients[0]);
    });

    it('does not add to an unknown recipe', async () => {
      recipeRepository.findById.mockResolvedValue(null);

      await expect(service.addIngredient(RECIPE_ID, ingredients[0])).rejects.toBeInstanceOf(
        RecipeNotFoundException,
      );
      expect(ingredientRepository.create).not.toHaveBeenCalled();
    });

    it('updates one of the recipe', async () => {
      await service.updateIngredient(RECIPE_ID, INGREDIENT_ID, { quantityG: 50 });

      expect(ingredientRepository.findOne).toHaveBeenCalledWith(RECIPE_ID, INGREDIENT_ID);
      expect(foodItemService.assertExist).not.toHaveBeenCalled();
      expect(ingredientRepository.update).toHaveBeenCalledWith(INGREDIENT_ID, { quantityG: 50 });
    });

    it('checks a changed food', async () => {
      await service.updateIngredient(RECIPE_ID, INGREDIENT_ID, { foodItemId: 'new-food' });

      expect(foodItemService.assertExist).toHaveBeenCalledWith(['new-food']);
    });

    it('removes one of the recipe', async () => {
      await service.removeIngredient(RECIPE_ID, INGREDIENT_ID);

      expect(ingredientRepository.delete).toHaveBeenCalledWith(INGREDIENT_ID);
    });

    it('refuses an ingredient of another recipe', async () => {
      ingredientRepository.findOne.mockResolvedValue(null);

      await expect(service.removeIngredient(RECIPE_ID, INGREDIENT_ID)).rejects.toBeInstanceOf(
        RecipeIngredientNotFoundException,
      );
      await expect(
        service.updateIngredient(RECIPE_ID, INGREDIENT_ID, { quantityG: 1 }),
      ).rejects.toBeInstanceOf(RecipeIngredientNotFoundException);
      expect(ingredientRepository.delete).not.toHaveBeenCalled();
      expect(ingredientRepository.update).not.toHaveBeenCalled();
    });
  });
});
