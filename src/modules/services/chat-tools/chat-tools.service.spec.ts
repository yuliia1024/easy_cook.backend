import { Prisma } from '../../../generated/prisma/client';
import {
  ChatToolName,
  ChatToolOperation,
  DietTag,
  FOOD_NUTRITION_MAX_RESULTS,
  Goal,
  MealType,
  SEARCH_RECIPES_DEFAULT_RESULTS,
  SEARCH_RECIPES_SCAN_LIMIT,
  SortOrder,
} from '../../../common/constants';
import {
  FoodItemsNotFoundBadRequestException,
  RecipeNotFoundException,
} from '../../../common/exceptions';
import { PreferenceRules, ProfileContext } from '../../../common/types';
import { createMock } from '../../../test/create-mock';
import {
  buildFoodItem,
  buildIngredient,
  buildRecipe,
  FOOD_ID,
  PROFILE_ID,
  RECIPE_ID,
} from '../../../test/fixtures';
import { FoodItemService } from '../food-item/food-item.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { RecipeService } from '../recipe/recipe.service';
import { ChatToolsService } from './chat-tools.service';

describe('ChatToolsService', () => {
  let recipeService: jest.Mocked<RecipeService>;
  let foodItemService: jest.Mocked<FoodItemService>;
  let service: ChatToolsService;
  const noRules: PreferenceRules = {
    diets: [],
    allergies: [],
    excludedIngredients: [],
    dislikedFoods: [],
  };
  const search = {
    query: null,
    mealType: null,
    diet: null,
    maxKcalPerServing: null,
    limit: null,
  };
  /** `buildRecipe()`: 200 g boiled rice for 2 servings. */
  const ricePerServing = { kcal: 130, proteinG: 2.7, fatG: 0.3, carbsG: 28.2 };

  beforeEach(() => {
    recipeService = createMock<RecipeService>();
    foodItemService = createMock<FoodItemService>();
    service = new ChatToolsService(recipeService, foodItemService, new NutritionService());
  });

  describe('tools', () => {
    it('has the read tools and the menu service calls, with their schemas', () => {
      const profile: ProfileContext = {
        profileId: PROFILE_ID,
        goal: Goal.Maintain,
        nutritionGoal: null,
        rules: noRules,
      };

      const tools = service.tools(profile);

      expect(tools.map(({ name, operation }) => [name, operation])).toEqual([
        [ChatToolName.SearchRecipes, ChatToolOperation.Read],
        [ChatToolName.GetRecipeDetails, ChatToolOperation.Read],
        [ChatToolName.GetFoodNutrition, ChatToolOperation.Read],
        [ChatToolName.CalculateNutrition, ChatToolOperation.Read],
        [ChatToolName.PlanMenu, ChatToolOperation.ServiceCall],
        [ChatToolName.ReviseMenu, ChatToolOperation.ServiceCall],
      ]);
      expect(tools.every(({ description }) => description.length > 0)).toBe(true);
    });

    it('marks the recipes against the rules of the profile', async () => {
      recipeService.getPage.mockResolvedValue({ items: [buildRecipe()], total: 1 });
      const [searchTool] = service.tools({
        profileId: PROFILE_ID,
        goal: Goal.Maintain,
        nutritionGoal: null,
        rules: { ...noRules, excludedIngredients: ['rice'] },
      });

      const result = await (searchTool as { execute: (input: object) => Promise<object> }).execute(
        search,
      );

      expect(result).toMatchObject({ recipes: [{ id: RECIPE_ID, fitsProfile: false }] });
    });
  });

  describe('searchRecipes', () => {
    it('reads one page by name, meal and diet, with the calories of a serving', async () => {
      recipeService.getPage.mockResolvedValue({ items: [buildRecipe()], total: 1 });

      const result = await service.searchRecipes(
        { ...search, query: 'rice', mealType: MealType.Lunch, diet: DietTag.Vegetarian },
        noRules,
      );

      expect(recipeService.getPage).toHaveBeenCalledWith(
        {
          search: 'rice',
          mealType: MealType.Lunch,
          dietTypeGroups: [[DietTag.Vegetarian, DietTag.Vegan]],
        },
        { page: 1, limit: SEARCH_RECIPES_DEFAULT_RESULTS, sortOrder: SortOrder.Asc },
      );
      expect(result).toEqual({
        recipes: [
          {
            id: RECIPE_ID,
            name: 'Rice with vegetables',
            mealType: MealType.Lunch,
            diets: [DietTag.Vegan],
            servings: 2,
            prepTimeMinutes: 20,
            perServing: ricePerServing,
            complete: true,
            fitsProfile: true,
          },
        ],
        more: false,
      });
    });

    it('says when more recipes match than the page has; null rules are no profile', async () => {
      recipeService.getPage.mockResolvedValue({ items: [buildRecipe()], total: 4 });

      await expect(service.searchRecipes({ ...search, limit: 1 }, null)).resolves.toMatchObject({
        recipes: [{ fitsProfile: null }],
        more: true,
      });
      expect(recipeService.getPage).toHaveBeenCalledWith(
        { search: undefined, mealType: undefined, dietTypeGroups: undefined },
        expect.objectContaining({ limit: 1 }),
      );
    });

    it('filters by the calories of a serving among a wider page', async () => {
      const light = buildRecipe({ id: 'light' });
      const heavy = buildRecipe({
        id: 'heavy',
        ingredients: [buildIngredient({ quantityG: new Prisma.Decimal(1000) })],
      });
      recipeService.getPage.mockResolvedValue({ items: [heavy, light, light], total: 3 });

      const result = await service.searchRecipes(
        { ...search, maxKcalPerServing: 200, limit: 1 },
        null,
      );

      expect(recipeService.getPage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ limit: SEARCH_RECIPES_SCAN_LIMIT }),
      );
      expect(result.recipes.map(({ id }) => id)).toEqual(['light']);
      expect(result.more).toBe(true);
    });
  });

  describe('getRecipeDetails', () => {
    it('gives the ingredients, instructions and nutrition of a serving', async () => {
      recipeService.getById.mockResolvedValue(buildRecipe({ allergens: ['gluten'] }));

      await expect(service.getRecipeDetails({ recipeId: RECIPE_ID }, null)).resolves.toMatchObject({
        id: RECIPE_ID,
        instructions: 'Boil the rice.',
        description: null,
        allergens: ['gluten'],
        perServing: ricePerServing,
        ingredients: [
          {
            foodId: FOOD_ID,
            foodName: 'White rice, boiled',
            state: 'boiled',
            quantityG: 200,
            isOptional: false,
          },
        ],
      });
      expect(recipeService.getById).toHaveBeenCalledWith(RECIPE_ID);
    });

    it('lets an unknown recipe through as not found', async () => {
      recipeService.getById.mockRejectedValue(new RecipeNotFoundException());

      await expect(service.getRecipeDetails({ recipeId: RECIPE_ID }, null)).rejects.toBeInstanceOf(
        RecipeNotFoundException,
      );
    });
  });

  describe('getFoodNutrition', () => {
    it('searches the foods and gives the values of 100 g and of the quantity', async () => {
      foodItemService.getPage.mockResolvedValue({ items: [buildFoodItem()], total: 1 });

      await expect(service.getFoodNutrition({ query: 'rice', quantityG: 150 })).resolves.toEqual({
        foods: [
          {
            id: FOOD_ID,
            name: 'White rice, boiled',
            state: 'boiled',
            per100g: { kcal: 130, proteinG: 2.7, fatG: 0.3, carbsG: 28.2 },
            quantityG: 150,
            forQuantity: { kcal: 195, proteinG: 4.1, fatG: 0.5, carbsG: 42.3 },
          },
        ],
      });
      expect(foodItemService.getPage).toHaveBeenCalledWith(
        { search: 'rice' },
        { page: 1, limit: FOOD_NUTRITION_MAX_RESULTS, sortOrder: SortOrder.Asc },
      );
    });

    it('defaults to 100 g and keeps an unknown value null, never 0', async () => {
      foodItemService.getPage.mockResolvedValue({
        items: [buildFoodItem({ fatG: null })],
        total: 1,
      });

      const { foods } = await service.getFoodNutrition({ query: 'rice', quantityG: null });

      expect(foods[0]).toMatchObject({
        quantityG: 100,
        per100g: { fatG: null },
        forQuantity: { kcal: 130, fatG: null },
      });
    });
  });

  describe('calculateNutrition', () => {
    it('adds up the foods by NutritionService, in total and per serving', async () => {
      foodItemService.getByIds.mockResolvedValue(new Map([[FOOD_ID, buildFoodItem()]]));

      const result = await service.calculateNutrition({
        items: [{ foodId: FOOD_ID, quantityG: 300 }],
        servings: 3,
      });

      expect(foodItemService.getByIds).toHaveBeenCalledWith([FOOD_ID]);
      expect(result).toEqual({
        servings: 3,
        total: { kcal: 390, proteinG: 8.1, fatG: 0.9, carbsG: 84.6 },
        perServing: { kcal: 130, proteinG: 2.7, fatG: 0.3, carbsG: 28.2 },
        complete: true,
        items: [
          {
            foodId: FOOD_ID,
            foodName: 'White rice, boiled',
            state: 'boiled',
            quantityG: 300,
            macros: { kcal: 390, proteinG: 8.1, fatG: 0.9, carbsG: 84.6 },
            missing: [],
          },
        ],
      });
    });

    it('is one serving by default and incomplete with an unknown value', async () => {
      foodItemService.getByIds.mockResolvedValue(
        new Map([[FOOD_ID, buildFoodItem({ carbsG: null })]]),
      );

      await expect(
        service.calculateNutrition({
          items: [{ foodId: FOOD_ID, quantityG: 100 }],
          servings: null,
        }),
      ).resolves.toMatchObject({
        servings: 1,
        complete: false,
        items: [{ missing: ['carbsG'] }],
      });
    });

    it('lets unknown foods through as a bad request', async () => {
      foodItemService.getByIds.mockRejectedValue(
        new FoodItemsNotFoundBadRequestException([FOOD_ID]),
      );

      await expect(
        service.calculateNutrition({ items: [{ foodId: FOOD_ID, quantityG: 100 }], servings: 1 }),
      ).rejects.toBeInstanceOf(FoodItemsNotFoundBadRequestException);
    });
  });
});
