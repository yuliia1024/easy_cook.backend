import { Prisma } from '../../../generated/prisma/client';
import {
  ChatStreamEventType,
  ChatToolName,
  ChatToolOperation,
  DietTag,
  FOOD_NUTRITION_MAX_RESULTS,
  Goal,
  MealType,
  MessageRole,
  PreferenceChangeAction,
  PreferenceChangeStatus,
  PreferenceType,
  RECIPE_SEARCH_MAX_LIMIT,
  SaveMenuStatus,
  SEARCH_RECIPES_DEFAULT_RESULTS,
  SEARCH_RECIPES_SCAN_LIMIT,
  SEARCH_RECIPES_SIMILAR_MAX,
  SortOrder,
} from '../../../common/constants';
import {
  ConversationNotFoundException,
  FoodItemsNotFoundBadRequestException,
  MenuDraftNotFoundException,
  MenuViolatesRulesBadRequestException,
  RecipeNotFoundException,
} from '../../../common/exceptions';
import { PreferenceRules, ProfileContext } from '../../../common/types';
import { createMock } from '../../../test/create-mock';
import {
  buildConversation,
  buildFoodItem,
  buildIngredient,
  buildMenu,
  buildMessage,
  buildRecipe,
  buildSearchResult,
  CONVERSATION_ID,
  FOOD_ID,
  MENU_ID,
  MENU_VERSION_ID,
  PROFILE_ID,
  RECIPE_ID,
} from '../../../test/fixtures';
import { ConversationService } from '../conversation/conversation.service';
import { FoodItemService } from '../food-item/food-item.service';
import { MenuService } from '../menu/menu.service';
import { PreferenceChangeService } from '../preference-change/preference-change.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { RecipeService } from '../recipe/recipe.service';
import { RecipeSearchResult, RecipeSearchService } from '../recipe-search/recipe-search.service';
import { RecipeWithIngredients } from '../../data-access/recipe/recipe.repository';
import { ChatToolsService } from './chat-tools.service';

type Executable = { execute: (input: object) => Promise<object> };

describe('ChatToolsService', () => {
  let recipeService: jest.Mocked<RecipeService>;
  let recipeSearchService: jest.Mocked<RecipeSearchService>;
  let foodItemService: jest.Mocked<FoodItemService>;
  let conversationService: jest.Mocked<ConversationService>;
  let menuService: jest.Mocked<MenuService>;
  let preferenceChangeService: jest.Mocked<PreferenceChangeService>;
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
    maxPrepTimeMinutes: null,
    limit: null,
  };
  const found = (...recipes: RecipeWithIngredients[]): RecipeSearchResult =>
    buildSearchResult(recipes);
  /** `buildRecipe()`: 200 g boiled rice for 2 servings. */
  const ricePerServing = { kcal: 130, proteinG: 2.7, fatG: 0.3, carbsG: 28.2 };

  beforeEach(() => {
    recipeService = createMock<RecipeService>();
    recipeSearchService = createMock<RecipeSearchService>();
    foodItemService = createMock<FoodItemService>();
    conversationService = createMock<ConversationService>();
    menuService = createMock<MenuService>();
    preferenceChangeService = createMock<PreferenceChangeService>();
    service = new ChatToolsService(
      recipeService,
      recipeSearchService,
      foodItemService,
      new NutritionService(),
      conversationService,
      menuService,
      preferenceChangeService,
    );
  });

  describe('tools', () => {
    it('has the read tools, the menu service calls and save_menu, with their schemas', () => {
      const profile: ProfileContext = {
        profileId: PROFILE_ID,
        goal: Goal.Maintain,
        nutritionGoal: null,
        rules: noRules,
      };

      const tools = service.tools(profile, CONVERSATION_ID);

      expect(tools.map(({ name, operation }) => [name, operation])).toEqual([
        [ChatToolName.SearchRecipes, ChatToolOperation.Read],
        [ChatToolName.GetRecipeDetails, ChatToolOperation.Read],
        [ChatToolName.GetFoodNutrition, ChatToolOperation.Read],
        [ChatToolName.CalculateNutrition, ChatToolOperation.Read],
        [ChatToolName.PlanMenu, ChatToolOperation.ServiceCall],
        [ChatToolName.ReviseMenu, ChatToolOperation.ServiceCall],
        [ChatToolName.SaveMenu, ChatToolOperation.Write],
        [ChatToolName.ProposePreferenceChange, ChatToolOperation.Write],
        [ChatToolName.ApplyPreferenceChange, ChatToolOperation.Write],
      ]);
      expect(tools.every(({ description }) => description.length > 0)).toBe(true);
    });

    it('marks the recipes against the rules of the profile', async () => {
      recipeService.getPage.mockResolvedValue({ items: [buildRecipe()], total: 1 });
      const [searchTool] = service.tools(
        {
          profileId: PROFILE_ID,
          goal: Goal.Maintain,
          nutritionGoal: null,
          rules: { ...noRules, excludedIngredients: ['rice'] },
        },
        CONVERSATION_ID,
      );

      const result = await (searchTool as unknown as Executable).execute(search);

      expect(result).toMatchObject({ recipes: [{ id: RECIPE_ID, fitsProfile: false }] });
    });

    it('has save_menu save the menu of the conversation, whatever the model passes', async () => {
      conversationService.getById.mockResolvedValue(buildConversation());
      const saveTool = service
        .tools(null, CONVERSATION_ID)
        .find(({ name }) => name === ChatToolName.SaveMenu)!;

      expect(saveTool.inputSchema.parse({ menuId: 'made-up' })).toEqual({});
      await expect((saveTool as unknown as Executable).execute({})).rejects.toThrow(
        MenuDraftNotFoundException,
      );
      expect(conversationService.getById).toHaveBeenCalledWith(CONVERSATION_ID);
    });
  });

  describe('preference changes', () => {
    const change = {
      action: PreferenceChangeAction.Add,
      preferenceType: PreferenceType.Allergy,
      value: 'peanut',
    };

    it('proposes a change for the client to confirm, writing nothing', async () => {
      preferenceChangeService.propose.mockResolvedValue({
        status: PreferenceChangeStatus.Proposed,
        change,
      });

      await expect(service.proposePreferenceChange(change)).resolves.toEqual({
        output: { status: PreferenceChangeStatus.Proposed, change },
        event: { type: ChatStreamEventType.PreferenceChangeProposed, change },
      });
      expect(preferenceChangeService.applyInChat).not.toHaveBeenCalled();
    });

    it('streams no proposal for a change in effect already', async () => {
      preferenceChangeService.propose.mockResolvedValue({
        status: PreferenceChangeStatus.AlreadyApplied,
        change,
      });

      await expect(service.proposePreferenceChange(change)).resolves.toMatchObject({
        event: null,
      });
    });

    it('applies the pending change of the conversation, without arguments from the model', async () => {
      preferenceChangeService.applyInChat.mockResolvedValue({
        status: PreferenceChangeStatus.Applied,
        change,
      });
      const applyTool = service
        .tools(null, CONVERSATION_ID)
        .find(({ name }) => name === ChatToolName.ApplyPreferenceChange)!;

      expect(applyTool.inputSchema.parse(change)).toEqual({});
      await expect((applyTool as unknown as Executable).execute({})).resolves.toEqual({
        output: { status: PreferenceChangeStatus.Applied, change },
        event: { type: ChatStreamEventType.PreferencesUpdated, change },
      });
      expect(preferenceChangeService.applyInChat).toHaveBeenCalledWith(CONVERSATION_ID);
    });

    it('does not apply a change proposed earlier in the same reply', () => {
      const applyTool = service
        .tools(null, CONVERSATION_ID)
        .find(({ name }) => name === ChatToolName.ApplyPreferenceChange)!;

      expect(applyTool).toMatchObject({ notAfter: [ChatToolName.ProposePreferenceChange] });
    });
  });

  describe('saveMenu', () => {
    const OLDER_VERSION_ID = '88888888-8888-4888-8888-888888888888';
    const suggested = (versionId: string) =>
      buildMessage({
        role: MessageRole.Assistant,
        content: 'Here is your menu.',
        menuVersionId: versionId,
        menuVersion: { menuId: MENU_ID, compositionSnapshot: {} },
      });
    const savedEvent = {
      type: ChatStreamEventType.MenuSaved,
      menuId: MENU_ID,
      versionId: MENU_VERSION_ID,
    };

    it('confirms the latest version the conversation suggested, as the confirm button does', async () => {
      conversationService.getById.mockResolvedValue(
        buildConversation({
          messages: [suggested(OLDER_VERSION_ID), buildMessage(), suggested(MENU_VERSION_ID)],
        }),
      );
      menuService.getById.mockResolvedValue(buildMenu());
      menuService.confirm.mockResolvedValue(
        buildMenu({ confirmedVersionId: MENU_VERSION_ID, title: '3-day menu' }),
      );

      const result = await service.saveMenu(CONVERSATION_ID);

      expect(conversationService.getById).toHaveBeenCalledWith(CONVERSATION_ID);
      expect(menuService.confirm).toHaveBeenCalledWith(MENU_ID, MENU_VERSION_ID);
      expect(result).toEqual({
        output: { status: SaveMenuStatus.Saved, title: '3-day menu' },
        event: savedEvent,
      });
    });

    it('does not confirm a version that is confirmed already, and says so', async () => {
      conversationService.getById.mockResolvedValue(
        buildConversation({ messages: [suggested(MENU_VERSION_ID)] }),
      );
      menuService.getById.mockResolvedValue(buildMenu({ confirmedVersionId: MENU_VERSION_ID }));

      const result = await service.saveMenu(CONVERSATION_ID);

      expect(menuService.confirm).not.toHaveBeenCalled();
      expect(result).toEqual({
        output: { status: SaveMenuStatus.AlreadySaved, title: 'Week 1' },
        event: savedEvent,
      });
    });

    it('confirms a newer draft when an older version of the menu is confirmed', async () => {
      conversationService.getById.mockResolvedValue(
        buildConversation({ messages: [suggested(OLDER_VERSION_ID), suggested(MENU_VERSION_ID)] }),
      );
      menuService.getById.mockResolvedValue(buildMenu({ confirmedVersionId: OLDER_VERSION_ID }));
      menuService.confirm.mockResolvedValue(buildMenu({ confirmedVersionId: MENU_VERSION_ID }));

      const result = await service.saveMenu(CONVERSATION_ID);

      expect(menuService.confirm).toHaveBeenCalledWith(MENU_ID, MENU_VERSION_ID);
      expect(result.output).toEqual({ status: SaveMenuStatus.Saved, title: 'Week 1' });
    });

    it('rejects a conversation without a suggested menu', async () => {
      conversationService.getById.mockResolvedValue(
        buildConversation({ messages: [buildMessage()] }),
      );

      await expect(service.saveMenu(CONVERSATION_ID)).rejects.toThrow(MenuDraftNotFoundException);
      expect(menuService.confirm).not.toHaveBeenCalled();
    });

    it('rejects a conversation of another profile', async () => {
      conversationService.getById.mockRejectedValue(new ConversationNotFoundException());

      await expect(service.saveMenu(CONVERSATION_ID)).rejects.toThrow(
        ConversationNotFoundException,
      );
      expect(menuService.getById).not.toHaveBeenCalled();
    });

    it('passes on a version that no longer fits the preferences', async () => {
      conversationService.getById.mockResolvedValue(
        buildConversation({ messages: [suggested(MENU_VERSION_ID)] }),
      );
      menuService.getById.mockResolvedValue(buildMenu());
      menuService.confirm.mockRejectedValue(
        new MenuViolatesRulesBadRequestException(['day 1: contains peanut']),
      );

      await expect(service.saveMenu(CONVERSATION_ID)).rejects.toThrow(
        MenuViolatesRulesBadRequestException,
      );
    });
  });

  describe('searchRecipes', () => {
    it('ranks the recipes for a query, filtered in the search by the request and the profile', async () => {
      recipeSearchService.search.mockResolvedValue(found(buildRecipe()));
      const abort = new AbortController();

      const result = await service.searchRecipes(
        {
          ...search,
          query: 'щось легке з рисом',
          mealType: MealType.Lunch,
          diet: DietTag.Vegetarian,
          maxPrepTimeMinutes: 30,
        },
        { ...noRules, diets: [DietTag.DairyFree], allergies: ['dairy', 'lactose', 'kiwi'] },
        abort.signal,
      );

      expect(recipeSearchService.search).toHaveBeenCalledWith(
        {
          text: 'щось легке з рисом',
          filters: {
            mealType: MealType.Lunch,
            dietTypeGroups: [
              [DietTag.Vegetarian, DietTag.Vegan],
              [DietTag.DairyFree, DietTag.Vegan],
            ],
            excludeAllergens: ['milk'],
            maxPrepTimeMinutes: 30,
          },
          limit: SEARCH_RECIPES_DEFAULT_RESULTS + 1,
        },
        abort.signal,
      );
      expect(recipeService.getPage).not.toHaveBeenCalled();
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
        similar: [],
      });
    });

    it('keeps the order of the search, says when more were found and passes no empty filter', async () => {
      const first = buildRecipe({ id: 'first' });
      const second = buildRecipe({ id: 'second' });
      recipeSearchService.search.mockResolvedValue(found(second, first));

      const result = await service.searchRecipes({ ...search, query: 'rice', limit: 1 }, null);

      expect(recipeSearchService.search).toHaveBeenCalledWith(
        {
          text: 'rice',
          filters: {
            mealType: undefined,
            dietTypeGroups: undefined,
            excludeAllergens: undefined,
            maxPrepTimeMinutes: undefined,
          },
          limit: 2,
        },
        undefined,
      );
      expect(result.recipes.map(({ id, fitsProfile }) => [id, fitsProfile])).toEqual([
        ['second', null],
      ]);
      expect(result.more).toBe(true);
    });

    it('filters the ranked recipes by the calories of a serving among the widest result', async () => {
      const light = buildRecipe({ id: 'light' });
      const heavy = buildRecipe({
        id: 'heavy',
        ingredients: [buildIngredient({ quantityG: new Prisma.Decimal(1000) })],
      });
      recipeSearchService.search.mockResolvedValue(found(heavy, light));

      const result = await service.searchRecipes(
        { ...search, query: 'rice', maxKcalPerServing: 200 },
        null,
      );

      expect(recipeSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({ limit: RECIPE_SEARCH_MAX_LIMIT }),
        undefined,
      );
      expect(result.recipes.map(({ id }) => id)).toEqual(['light']);
      expect(result.more).toBe(false);
    });

    it('gives only the closest recipes as similar when none fits the query', async () => {
      const recipes = ['a', 'b', 'c', 'd'].map((id) => buildRecipe({ id }));
      recipeSearchService.search.mockResolvedValue(buildSearchResult(recipes, { matched: false }));

      const result = await service.searchRecipes({ ...search, query: 'sushi' }, null);

      expect(result.recipes).toEqual([]);
      expect(result.more).toBe(false);
      expect(result.similar.map(({ id }) => id)).toEqual(
        ['a', 'b', 'c'].slice(0, SEARCH_RECIPES_SIMILAR_MAX),
      );
    });

    it('lists one page by meal and diet without a query', async () => {
      recipeService.getPage.mockResolvedValue({ items: [buildRecipe()], total: 1 });

      const result = await service.searchRecipes(
        { ...search, mealType: MealType.Lunch, diet: DietTag.Vegetarian },
        noRules,
      );

      expect(recipeSearchService.search).not.toHaveBeenCalled();
      expect(recipeService.getPage).toHaveBeenCalledWith(
        { mealType: MealType.Lunch, dietTypeGroups: [[DietTag.Vegetarian, DietTag.Vegan]] },
        { page: 1, limit: SEARCH_RECIPES_DEFAULT_RESULTS, sortOrder: SortOrder.Asc },
      );
      expect(result).toEqual({
        recipes: [expect.objectContaining({ id: RECIPE_ID, fitsProfile: true })],
        more: false,
        similar: [],
      });
    });

    it('says when more recipes match than the page has; null rules are no profile', async () => {
      recipeService.getPage.mockResolvedValue({ items: [buildRecipe()], total: 4 });

      await expect(service.searchRecipes({ ...search, limit: 1 }, null)).resolves.toMatchObject({
        recipes: [{ fitsProfile: null }],
        more: true,
      });
      expect(recipeService.getPage).toHaveBeenCalledWith(
        { mealType: undefined, dietTypeGroups: undefined },
        expect.objectContaining({ limit: 1 }),
      );
    });

    it('filters a listing by the calories of a serving among a wider page', async () => {
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

    it('filters a listing by the time, a recipe of unknown time left out', async () => {
      const quick = buildRecipe({ id: 'quick', prepTimeMinutes: 15 });
      const slow = buildRecipe({ id: 'slow', prepTimeMinutes: 60 });
      const unknown = buildRecipe({ id: 'unknown', prepTimeMinutes: null });
      recipeService.getPage.mockResolvedValue({ items: [slow, unknown, quick], total: 3 });

      const result = await service.searchRecipes({ ...search, maxPrepTimeMinutes: 20 }, null);

      expect(recipeService.getPage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ limit: SEARCH_RECIPES_SCAN_LIMIT }),
      );
      expect(result).toEqual({
        recipes: [expect.objectContaining({ id: 'quick' })],
        more: false,
        similar: [],
      });
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
