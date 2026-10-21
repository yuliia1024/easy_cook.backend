import { Prisma } from '../../../generated/prisma/client';
import { FoodState, MealType, RecipeSource, SortOrder } from '../../../common/constants';
import {
  FoodItemsNotFoundBadRequestException,
  RecipeIngredientNotFoundException,
  RecipeNotFoundException,
  RecipeSourceConflictException,
  ServingTooHeavyBadRequestException,
  ServingTooManyKcalBadRequestException,
  TooManyIngredientsBadRequestException,
} from '../../../common/exceptions';
import { PreferenceRules } from '../../../common/types';
import { createMock } from '../../../test/create-mock';
import {
  buildFoodItem,
  buildIngredient,
  buildRecipe,
  FOOD_ID,
  INGREDIENT_ID,
  RECIPE_ID,
} from '../../../test/fixtures';
import { RecipeIngredientRepository } from '../../data-access/recipe-ingredient/recipe-ingredient.repository';
import { RecipeRepository } from '../../data-access/recipe/recipe.repository';
import { FoodItemService } from '../food-item/food-item.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { RecipeService } from './recipe.service';

const d = (value: number): Prisma.Decimal => new Prisma.Decimal(value);

const OIL_ID = '88888888-8888-4888-8888-888888888888';
/** 900 kcal, 100 g fat per 100 g. */
const oil = buildFoodItem({
  id: OIL_ID,
  name: 'Sunflower oil',
  kcalPer100g: d(900),
  proteinG: d(0),
  fatG: d(100),
  carbsG: d(0),
  state: FoodState.Other,
});

describe('RecipeService', () => {
  let recipeRepository: jest.Mocked<RecipeRepository>;
  let ingredientRepository: jest.Mocked<RecipeIngredientRepository>;
  let foodItemService: jest.Mocked<FoodItemService>;
  let service: RecipeService;
  /** 200 g of boiled rice (130 kcal / 100 g), 2 servings. */
  const recipe = buildRecipe();
  const data = {
    name: 'Soup',
    instructions: 'Boil',
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
    // Like the real one: the foods by id, 400 for an unknown id.
    foodItemService.getByIds.mockImplementation(async (ids) => {
      const foods = new Map([buildFoodItem(), oil].map((food) => [food.id, food]));
      const missing = ids.filter((id) => !foods.has(id));
      if (missing.length > 0) {
        throw new FoodItemsNotFoundBadRequestException(missing);
      }
      return new Map(ids.map((id) => [id, foods.get(id)!]));
    });
    service = new RecipeService(
      recipeRepository,
      ingredientRepository,
      foodItemService,
      new NutritionService(),
    );
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

    it('drops an excluded ingredient', async () => {
      await expect(
        service.getAllowed({ ...rules, excludedIngredients: ['rice'] }),
      ).resolves.toEqual([peanuts]);
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

  describe('create', () => {
    it('checks the foods and defaults the source to manual', async () => {
      await service.create(data, ingredients);

      expect(foodItemService.getByIds).toHaveBeenCalledWith([FOOD_ID]);
      expect(recipeRepository.create).toHaveBeenCalledWith(
        { ...data, source: RecipeSource.Manual },
        ingredients,
      );
    });

    it('refuses unknown foods', async () => {
      foodItemService.getByIds.mockRejectedValue(new FoodItemsNotFoundBadRequestException(['x']));

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

    it('refuses a serving heavier than 2 kg', async () => {
      // 8100 g / 4 servings = 2025 g
      await expect(
        service.create(data, [{ foodItemId: FOOD_ID, quantityG: 8100 }]),
      ).rejects.toThrow(new ServingTooHeavyBadRequestException(2025, 2000));
      expect(recipeRepository.create).not.toHaveBeenCalled();
    });

    it('refuses a serving over 2500 kcal, optional ingredients included', async () => {
      // 1200 g of oil = 10800 kcal / 4 servings = 2700 kcal
      await expect(
        service.create(data, [{ foodItemId: OIL_ID, quantityG: 1200, isOptional: true }]),
      ).rejects.toThrow(new ServingTooManyKcalBadRequestException(2700, 2500));
    });
  });

  describe('update', () => {
    it('changes fields only', async () => {
      await service.update(RECIPE_ID, { servings: 3 });

      expect(foodItemService.getByIds).not.toHaveBeenCalled();
      expect(recipeRepository.update).toHaveBeenCalledWith(RECIPE_ID, { servings: 3 }, undefined);
    });

    it('checks the stored ingredients against fewer servings', async () => {
      recipeRepository.findById.mockResolvedValue(
        buildRecipe({ servings: 2, ingredients: [buildIngredient({ quantityG: d(3000) })] }),
      );

      await expect(service.update(RECIPE_ID, { servings: 1 })).rejects.toBeInstanceOf(
        ServingTooHeavyBadRequestException,
      );
      expect(recipeRepository.update).not.toHaveBeenCalled();
    });

    it('checks the foods of a new ingredient list', async () => {
      await service.update(RECIPE_ID, {}, ingredients);

      expect(foodItemService.getByIds).toHaveBeenCalledWith([FOOD_ID]);
      expect(recipeRepository.update).toHaveBeenCalledWith(RECIPE_ID, {}, ingredients);
    });

    it('checks a new ingredient list against the stored servings', async () => {
      // 600 g of oil = 5400 kcal / 2 servings
      await expect(
        service.update(RECIPE_ID, {}, [{ foodItemId: OIL_ID, quantityG: 600 }]),
      ).rejects.toBeInstanceOf(ServingTooManyKcalBadRequestException);
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

      expect(foodItemService.getByIds).toHaveBeenCalledWith([FOOD_ID]);
      expect(ingredientRepository.create).toHaveBeenCalledWith(RECIPE_ID, ingredients[0]);
    });

    it('does not add to an unknown recipe', async () => {
      recipeRepository.findById.mockResolvedValue(null);

      await expect(service.addIngredient(RECIPE_ID, ingredients[0])).rejects.toBeInstanceOf(
        RecipeNotFoundException,
      );
      expect(ingredientRepository.create).not.toHaveBeenCalled();
    });

    it('does not add past 100 ingredients', async () => {
      recipeRepository.findById.mockResolvedValue(
        buildRecipe({
          servings: 100,
          ingredients: Array.from({ length: 100 }, () => buildIngredient({ quantityG: d(1) })),
        }),
      );

      await expect(service.addIngredient(RECIPE_ID, ingredients[0])).rejects.toBeInstanceOf(
        TooManyIngredientsBadRequestException,
      );
      expect(ingredientRepository.create).not.toHaveBeenCalled();
    });

    it('checks the serving with the added ingredient', async () => {
      // 200 g rice + 3900 g rice = 4100 g / 2 servings = 2050 g
      await expect(
        service.addIngredient(RECIPE_ID, { foodItemId: FOOD_ID, quantityG: 3900 }),
      ).rejects.toBeInstanceOf(ServingTooHeavyBadRequestException);
    });

    it('updates one of the recipe', async () => {
      await service.updateIngredient(RECIPE_ID, INGREDIENT_ID, { quantityG: 50 });

      expect(ingredientRepository.findOne).toHaveBeenCalledWith(RECIPE_ID, INGREDIENT_ID);
      expect(foodItemService.getByIds).not.toHaveBeenCalled();
      expect(ingredientRepository.update).toHaveBeenCalledWith(INGREDIENT_ID, { quantityG: 50 });
    });

    it('checks the serving with a changed quantity', async () => {
      // 5000 g / 2 servings
      await expect(
        service.updateIngredient(RECIPE_ID, INGREDIENT_ID, { quantityG: 5000 }),
      ).rejects.toBeInstanceOf(ServingTooHeavyBadRequestException);
      expect(ingredientRepository.update).not.toHaveBeenCalled();
    });

    it('checks a changed food and its energy', async () => {
      // 200 g of oil = 1800 kcal / 2 servings = 900 kcal: fine
      await service.updateIngredient(RECIPE_ID, INGREDIENT_ID, { foodItemId: OIL_ID });

      expect(foodItemService.getByIds).toHaveBeenCalledWith([OIL_ID]);
      expect(ingredientRepository.update).toHaveBeenCalled();
    });

    it('refuses a changed food that does not exist', async () => {
      await expect(
        service.updateIngredient(RECIPE_ID, INGREDIENT_ID, { foodItemId: 'new-food' }),
      ).rejects.toBeInstanceOf(FoodItemsNotFoundBadRequestException);
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
