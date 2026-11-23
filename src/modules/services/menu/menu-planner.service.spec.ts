import { Logger } from '@nestjs/common';
import {
  ChatResponseType,
  ChatStatusStep,
  ChatStreamEventType,
  Goal,
  CalculationMode,
  DietTag,
  MealType,
  MenuIssueCode,
  MenuIssueSeverity,
  MENU_DAY_MAX_OUTPUT_TOKENS,
  MENU_DAY_PROMPT,
  MENU_MEAL_MAX_OUTPUT_TOKENS,
  MENU_MEAL_PROMPT,
  MENU_PLAN_PROMPT,
  MENU_PLAN_MAX_ATTEMPTS,
  MENU_PLAN_MEAL_TYPES,
  MENU_PLAN_WISHED_SHARE,
  menuDayRetryMessage,
  menuMealRetryMessage,
  menuPlanMaxOutputTokens,
  menuPlanRetryMessage,
  NO_PROFILE_REPLY,
  wishOfferReply,
} from '../../../common/constants';
import {
  MenuDayPlan,
  MenuDayPlanSchema,
  MenuMealPlan,
  MenuMealPlanSchema,
  MenuPlan,
  MenuPlanSchema,
  MenuRequest,
} from '../../../common/contracts';
import { AssistantInvalidOutputException } from '../../../common/exceptions';
import {
  ChatProgressEvent,
  ChatResponse,
  ProfileContext,
  ResolvedDay,
} from '../../../common/types';
import { ModelResult, LlmService } from '../../../providers/llm/llm.service';
import { Prisma } from '../../../generated/prisma/client';
import { createMock } from '../../../test/create-mock';
import {
  buildFoodItem,
  buildIngredient,
  buildRecipe,
  buildRecipeSnapshot,
  buildSearchResult,
  PROFILE_ID,
} from '../../../test/fixtures';
import { NutritionService } from '../nutrition/nutrition.service';
import { toModelProfile } from '../profile-context/model-profile';
import { RecipeService } from '../recipe/recipe.service';
import { RecipeSearchResult, RecipeSearchService } from '../recipe-search/recipe-search.service';
import { MenuComposer } from './menu-composer';
import { EMPTY_MENU_REQUEST } from './menu-request';
import { MenuPlannerService, offeredRecipes } from './menu-planner.service';
import { candidatesPerMeal } from './menu-plan';

describe('MenuPlannerService', () => {
  let recipeService: jest.Mocked<RecipeService>;
  let recipeSearchService: jest.Mocked<RecipeSearchService>;
  let llmService: jest.Mocked<LlmService>;
  let service: MenuPlannerService;
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;
  /** 130 kcal per serving each (200 g boiled rice, 2 servings). */
  const breakfast = buildRecipe({
    id: 'rec-b',
    name: 'Rice porridge',
    mealType: MealType.Breakfast,
  });
  const lunch = buildRecipe({ id: 'rec-l', name: 'Rice bowl', mealType: MealType.Lunch });
  const dinner = buildRecipe({ id: 'rec-d', name: 'Rice salad', mealType: MealType.Dinner });
  const snack = buildRecipe({ id: 'rec-s', name: 'Rice cake', mealType: MealType.Snack });
  /** The short ids the model sees for the recipes above. */
  const meals = { breakfast: 'b1', lunch: 'l1', dinner: 'd1', snack: 's1' };
  const plan: MenuPlan = { message: 'Here is your day.', days: [{ dayIndex: 0, meals }] };
  const oneDay: MenuRequest = { ...EMPTY_MENU_REQUEST, days: 1 };
  const profile: ProfileContext = {
    profileId: PROFILE_ID,
    goal: Goal.LoseWeight,
    nutritionGoal: null,
    rules: { diets: ['vegan'], allergies: [], excludedIngredients: [], dislikedFoods: [] },
  };
  const sentMessages = (call = 0): Array<{ role: string; content: string }> =>
    llmService.generateStructuredResult.mock.calls[call][0] as Array<{
      role: string;
      content: string;
    }>;

  const modelId = 'gpt-test';
  /** What `generateStructuredResult` returns for `output`. */
  const result = (output: MenuPlan): ModelResult<MenuPlan> => ({
    output,
    modelId,
    latencyMs: 1,
    usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
  });

  beforeEach(() => {
    recipeService = createMock<RecipeService>();
    recipeService.getAllowed.mockResolvedValue([breakfast, lunch, dinner, snack]);
    llmService = createMock<LlmService>();
    llmService.generateStructuredResult.mockResolvedValue(result(plan));
    recipeSearchService = createMock<RecipeSearchService>();
    service = new MenuPlannerService(
      recipeService,
      recipeSearchService,
      new NutritionService(),
      llmService,
      new MenuComposer(),
    );
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('sends the model the request, the days, the profile and the candidates with their nutrition', async () => {
    const abort = new AbortController();
    const perServing = { kcal: 130, proteinG: 3, fatG: 0, carbsG: 28 };

    await service.plan('Light day', oneDay, profile, abort.signal);

    expect(recipeService.getAllowed).toHaveBeenCalledWith(profile.rules);
    expect(llmService.generateStructuredResult).toHaveBeenCalledWith(
      [
        {
          role: 'user',
          content: JSON.stringify({
            request: 'Light day',
            days: 1,
            profile: toModelProfile(profile),
            recipes: {
              breakfast: [{ id: 'b1', name: 'Rice porridge', perServing, complete: true }],
              lunch: [{ id: 'l1', name: 'Rice bowl', perServing, complete: true }],
              snack: [{ id: 's1', name: 'Rice cake', perServing, complete: true }],
              dinner: [{ id: 'd1', name: 'Rice salad', perServing, complete: true }],
            },
          }),
        },
      ],
      MenuPlanSchema,
      {
        prompt: MENU_PLAN_PROMPT,
        maxOutputTokens: menuPlanMaxOutputTokens(1),
        abortSignal: abort.signal,
      },
    );
  });

  describe('wishes', () => {
    const fishBowl = buildRecipe({ id: 'rec-fish', name: 'Fish bowl', mealType: MealType.Lunch });
    const porkBowl = buildRecipe({ id: 'rec-pork', name: 'Pork bowl', mealType: MealType.Lunch });
    /** `searchEach` answering each meal by `byMeal`, nothing for the others. */
    const searchFinds = (byMeal: Partial<Record<MealType, RecipeSearchResult>>): void => {
      recipeSearchService.searchEach.mockImplementation(async (_query, filters) =>
        filters.map(
          ({ mealType }) =>
            byMeal[mealType as MealType] ?? buildSearchResult([], { matched: false }),
        ),
      );
    };
    const lunchNames = (): string[] =>
      (
        JSON.parse(sentMessages()[0].content) as {
          recipes: Record<string, Array<{ name: string }>>;
        }
      ).recipes.lunch.map(({ name }) => name);

    beforeEach(() => {
      recipeService.getAllowed.mockResolvedValue([breakfast, lunch, fishBowl, dinner, snack]);
    });

    it('searches nothing without wishes and keeps the order of the recipes', async () => {
      await service.plan('Light day', oneDay, profile);

      expect(recipeSearchService.searchEach).not.toHaveBeenCalled();
      expect(lunchNames()).toEqual(['Rice bowl', 'Fish bowl']);
    });

    it('searches every meal with one embedding and puts the allowed matches first', async () => {
      const abort = new AbortController();
      searchFinds({ [MealType.Lunch]: buildSearchResult([porkBowl, fishBowl]) });

      await service.plan('More fish', { ...oneDay, wishes: 'more fish' }, profile, abort.signal);

      expect(recipeSearchService.searchEach).toHaveBeenCalledTimes(1);
      expect(recipeSearchService.searchEach).toHaveBeenCalledWith(
        { text: 'more fish', limit: Math.ceil(candidatesPerMeal(1) * MENU_PLAN_WISHED_SHARE) * 2 },
        MENU_PLAN_MEAL_TYPES.map((mealType) => ({
          mealType,
          dietTypeGroups: [['vegan']],
          excludeAllergens: undefined,
        })),
        abort.signal,
      );
      expect(lunchNames()).toEqual(['Fish bowl', 'Rice bowl']);
    });

    it('offers the closest allowed recipes instead of a menu when no meal fits the wishes', async () => {
      const similar = (recipes: Array<typeof lunch>, similarity: number): RecipeSearchResult => {
        const result = buildSearchResult(recipes, { matched: false });
        result.hits.forEach((hit) => {
          hit.similarity = similarity;
        });
        return result;
      };
      searchFinds({
        [MealType.Lunch]: similar([porkBowl, fishBowl], 0.45),
        [MealType.Dinner]: similar([dinner], 0.48),
      });

      const response = await service.plan('Sushi', { ...oneDay, wishes: 'sushi' }, profile);

      expect(response).toEqual({
        type: ChatResponseType.WishOffer,
        message: wishOfferReply('sushi', ['Rice salad', 'Fish bowl']),
        offer: {
          wishes: 'sushi',
          recipes: [
            { id: 'rec-d', name: 'Rice salad', mealType: MealType.Dinner },
            { id: 'rec-fish', name: 'Fish bowl', mealType: MealType.Lunch },
          ],
        },
      });
      expect(llmService.generateStructuredResult).not.toHaveBeenCalled();
    });

    it('takes a meal as fitting only by a recipe the rules allow', async () => {
      // The pork bowl matches the wishes but the rules leave it out: lunch has only similar ones.
      const lunchFound = buildSearchResult([porkBowl, fishBowl]);
      lunchFound.hits[1].match = false;
      searchFinds({ [MealType.Lunch]: lunchFound });

      await expect(
        service.plan('Pork', { ...oneDay, wishes: 'pork' }, profile),
      ).resolves.toMatchObject({
        type: ChatResponseType.WishOffer,
        offer: { recipes: [{ id: 'rec-fish' }] },
      });
    });

    it('takes the wished recipes of the meals that fit and no offer', async () => {
      searchFinds({
        [MealType.Lunch]: buildSearchResult([fishBowl]),
        [MealType.Breakfast]: buildSearchResult([breakfast], { matched: false }),
      });

      await expect(
        service.plan('More fish', { ...oneDay, wishes: 'more fish' }, profile),
      ).resolves.toMatchObject({ type: ChatResponseType.MenuReady });
      expect(lunchNames()).toEqual(['Fish bowl', 'Rice bowl']);
    });

    it('plans with the recipes of an accepted offer, without searching again', async () => {
      const offer = {
        wishes: 'sushi',
        recipes: [
          { id: 'rec-fish', name: 'Fish bowl', mealType: MealType.Lunch },
          { id: 'rec-gone', name: 'Deleted', mealType: MealType.Dinner },
        ],
      };

      await service.plan(
        'Sushi',
        { ...oneDay, wishes: 'sushi' },
        profile,
        undefined,
        undefined,
        offer,
      );

      expect(recipeSearchService.searchEach).not.toHaveBeenCalled();
      expect(lunchNames()).toEqual(['Fish bowl', 'Rice bowl']);
    });

    it('plans without the wishes when the search fails', async () => {
      recipeSearchService.searchEach.mockRejectedValue(new Error('db down'));

      await expect(
        service.plan('More fish', { ...oneDay, wishes: 'more fish' }, profile),
      ).resolves.toMatchObject({ type: ChatResponseType.MenuReady });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('planning without it: db down'));
      expect(lunchNames()).toEqual(['Rice bowl', 'Fish bowl']);
    });
  });

  it('composes the chosen recipes into a one-day menu with a snack, one serving each, without issues when there is no goal, with the model and prompt version', async () => {
    await expect(service.plan('Light day', oneDay, profile)).resolves.toMatchObject({
      type: ChatResponseType.MenuReady,
      message: 'Here is your day.',
      menu: {
        days: [
          {
            dayIndex: 0,
            date: null,
            meals: [
              { position: 0, mealType: MealType.Breakfast, recipeId: 'rec-b', servings: 1 },
              { position: 1, mealType: MealType.Lunch, recipeId: 'rec-l', servings: 1 },
              { position: 2, mealType: MealType.Snack, recipeId: 'rec-s', servings: 1 },
              { position: 3, mealType: MealType.Dinner, recipeId: 'rec-d', servings: 1 },
            ],
            totals: { kcal: 520 },
          },
        ],
        issues: [],
      },
      days: [
        {
          dayIndex: 0,
          date: null,
          meals: [
            {
              mealType: MealType.Breakfast,
              servings: 1,
              recipeId: 'rec-b',
              recipe: { id: 'rec-b' },
            },
            { mealType: MealType.Lunch, servings: 1, recipeId: 'rec-l', recipe: { id: 'rec-l' } },
            { mealType: MealType.Snack, servings: 1, recipeId: 'rec-s', recipe: { id: 'rec-s' } },
            { mealType: MealType.Dinner, servings: 1, recipeId: 'rec-d', recipe: { id: 'rec-d' } },
          ],
        },
      ],
      generatedWith: { modelId, prompt: 'menu-plan@v1' },
    });
    expect(log).toHaveBeenCalledWith(
      'Menu of 1 days planned in 1 attempt(s) by gpt-test with menu-plan@v1',
    );
  });

  it('plans every requested day, in the order of dayIndex, and composes them all', async () => {
    const lunch2 = buildRecipe({ id: 'rec-l2', name: 'Rice soup', mealType: MealType.Lunch });
    recipeService.getAllowed.mockResolvedValue([
      breakfast,
      buildRecipe({ id: 'rec-b2', mealType: MealType.Breakfast }),
      lunch,
      lunch2,
      snack,
      buildRecipe({ id: 'rec-s2', mealType: MealType.Snack }),
      dinner,
      buildRecipe({ id: 'rec-d2', mealType: MealType.Dinner }),
    ]);
    llmService.generateStructuredResult.mockResolvedValue(
      result({
        message: 'Three days.',
        days: [
          { dayIndex: 2, meals },
          { dayIndex: 0, meals },
          { dayIndex: 1, meals: { ...meals, lunch: 'l2' } },
        ],
      }),
    );

    const response = await service.plan('Three days', { ...oneDay, days: 3 }, profile);

    expect(JSON.parse(sentMessages()[0].content).days).toBe(3);
    expect(llmService.generateStructuredResult.mock.calls[0][2].maxOutputTokens).toBe(
      menuPlanMaxOutputTokens(3),
    );
    expect(response).toMatchObject({
      type: ChatResponseType.MenuReady,
      menu: {
        days: [
          { dayIndex: 0, meals: [{ recipeId: 'rec-b' }, { recipeId: 'rec-l' }, {}, {}] },
          { dayIndex: 1, meals: [{ recipeId: 'rec-b' }, { recipeId: 'rec-l2' }, {}, {}] },
          { dayIndex: 2, meals: [{ recipeId: 'rec-b' }, { recipeId: 'rec-l' }, {}, {}] },
        ],
        dailyAverage: { kcal: 520 },
      },
    });
  });

  it('plans one day when the request names no days', async () => {
    await service.plan('Light day', EMPTY_MENU_REQUEST, profile);

    expect(JSON.parse(sentMessages()[0].content).days).toBe(1);
  });

  it('offers at most the candidates the days need, closest to the calorie share of the meal', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const breakfasts = Array.from({ length: 20 }, (_, i) =>
      buildRecipe({
        id: `rec-b${i}`,
        name: `B${i}`,
        mealType: MealType.Breakfast,
        ingredients: [buildIngredient({ quantityG: new Prisma.Decimal(100 + i * 100) })],
      }),
    );
    recipeService.getAllowed.mockResolvedValue([...breakfasts, lunch, dinner, snack]);
    llmService.generateStructuredResult.mockResolvedValue(
      result({
        ...plan,
        days: [{ dayIndex: 0, meals }],
      }),
    );

    await service.plan('Light day', { ...oneDay, caloriesKcal: 2000 }, profile);

    // 500 kcal for breakfast is closest to B7 (520 kcal a serving), then B6 (455), B8 (585), ...
    const offered = JSON.parse(sentMessages()[0].content).recipes.breakfast as Array<{
      id: string;
      name: string;
    }>;
    expect(offered.map(({ id, name }) => [id, name])).toEqual([
      ['b1', 'B7'],
      ['b2', 'B6'],
      ['b3', 'B8'],
      ['b4', 'B5'],
      ['b5', 'B9'],
      ['b6', 'B4'],
    ]);
  });

  it('tells the model a recipe with unknown values is incomplete', async () => {
    const unknownFat = buildRecipe({
      id: 'rec-l',
      name: 'Rice bowl',
      ingredients: [buildIngredient({ foodItem: buildFoodItem({ fatG: null }) })],
    });
    recipeService.getAllowed.mockResolvedValue([breakfast, unknownFat, dinner, snack]);

    await service.plan('Light day', oneDay, profile);

    expect(JSON.parse(sentMessages()[0].content).recipes.lunch).toEqual([
      expect.objectContaining({ id: 'l1', complete: false }),
    ]);
  });

  it('fits the servings of every day to the daily calories of the request', async () => {
    const response = await service.plan('Light day', { ...oneDay, caloriesKcal: 780 }, profile);

    expect(response).toMatchObject({
      menu: {
        days: [
          {
            meals: [{ servings: 1.5 }, { servings: 1.5 }, { servings: 1.5 }, { servings: 1.5 }],
            totals: { kcal: 780 },
          },
        ],
      },
    });
  });

  it('warns when the day is off the calorie goal', async () => {
    const withGoal: ProfileContext = {
      ...profile,
      nutritionGoal: {
        goalId: 'g',
        caloriesKcal: 2000,
        proteinG: 104,
        fatG: 56,
        carbsG: 270,
        calculationMode: CalculationMode.Manual,
        ruleVersion: null,
      },
    };

    const response = await service.plan('Light day', oneDay, withGoal);

    expect(response).toMatchObject({
      menu: {
        issues: [
          {
            severity: MenuIssueSeverity.Warning,
            code: MenuIssueCode.CaloriesOffTarget,
            message: 'Day 1: 520 kcal is 74 % below the 2000 kcal goal',
            dayIndex: 0,
          },
        ],
      },
    });
    expect(llmService.generateStructuredResult).toHaveBeenCalledTimes(1);
  });

  it('follows the constraints of the request on top of the profile rules', async () => {
    const rules = {
      diets: ['vegan'],
      allergies: [],
      excludedIngredients: ['chicken'],
      dislikedFoods: ['rice'],
    };

    const response = await service.plan(
      'Light day without chicken',
      {
        ...oneDay,
        diets: [DietTag.Vegan],
        excludedIngredients: ['chicken'],
        dislikedFoods: ['rice'],
      },
      profile,
    );

    expect(recipeService.getAllowed).toHaveBeenCalledWith(rules);
    expect(JSON.parse(sentMessages()[0].content).profile).toEqual(
      toModelProfile({ ...profile, rules }),
    );
    expect(response).toMatchObject({
      menu: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: MenuIssueCode.DislikedFood }),
        ]),
      },
    });
  });

  it('reports the issues of the chosen recipes against the preferences', async () => {
    const response = await service.plan('Light day', oneDay, {
      ...profile,
      rules: { ...profile.rules, dislikedFoods: ['rice'] },
    });

    expect(response).toMatchObject({
      menu: {
        issues: [
          expect.objectContaining({ code: MenuIssueCode.DislikedFood, position: 0 }),
          expect.objectContaining({ code: MenuIssueCode.DislikedFood, position: 1 }),
          expect.objectContaining({ code: MenuIssueCode.DislikedFood, position: 2 }),
          expect.objectContaining({ code: MenuIssueCode.DislikedFood, position: 3 }),
        ],
      },
    });
  });

  describe('too few recipes', () => {
    const meat = buildRecipe({
      id: 'rec-meat',
      name: 'Chicken bowl',
      mealType: MealType.Lunch,
      dietType: [],
    });

    it('answers without the model, naming the rule that leaves too few and how to relax it', async () => {
      recipeService.getAllowed.mockResolvedValue([breakfast, dinner, snack]);
      recipeService.getAll.mockResolvedValue([breakfast, meat, dinner, snack]);
      const onProgress = jest.fn();

      await expect(
        service.plan('Light day', oneDay, profile, undefined, onProgress),
      ).resolves.toEqual({
        type: ChatResponseType.Text,
        message:
          "I can't plan a good 1-day menu: the vegan diet leaves no lunches, and it needs at least 1 recipe for every meal. To get a good menu, you could remove the vegan diet from your profile. Which would you like?",
      });
      expect(llmService.generateStructuredResult).not.toHaveBeenCalled();
      expect(onProgress.mock.calls).toEqual([
        [{ type: ChatStreamEventType.Status, step: ChatStatusStep.SearchingBreakfasts }],
      ]);
    });

    it('checks the rules of the request too and offers fewer days', async () => {
      const request: MenuRequest = { ...oneDay, days: 3, excludedIngredients: ['rice'] };
      recipeService.getAllowed.mockResolvedValue([]);
      recipeService.getAll.mockResolvedValue([breakfast, lunch, dinner, snack]);

      const response = await service.plan('Three days', request, profile);

      expect(recipeService.getAllowed).toHaveBeenCalledWith({
        ...profile.rules,
        excludedIngredients: ['rice'],
      });
      expect(response).toEqual({
        type: ChatResponseType.Text,
        message:
          "I can't plan a good 3-day menu: excluding rice leaves no breakfasts, no lunches, no snacks and no dinners, and it needs at least 2 different recipes for every meal. Please try a different request.",
      });
    });

    it('goes on to the model when every recipe shows no shortage (a recipe was added meanwhile)', async () => {
      recipeService.getAllowed.mockResolvedValue([breakfast, lunch, dinner]);
      recipeService.getAll.mockResolvedValue([breakfast, lunch, dinner, snack]);

      await expect(service.plan('Light day', oneDay, profile)).rejects.toBeInstanceOf(
        AssistantInvalidOutputException,
      );
      expect(llmService.generateStructuredResult).toHaveBeenCalled();
    });

    it('does not load every recipe when the allowed ones are enough', async () => {
      await service.plan('Light day', oneDay, profile);

      expect(recipeService.getAll).not.toHaveBeenCalled();
    });
  });

  it('reports the steps and the shape of the menu as it plans', async () => {
    const events: ChatProgressEvent[] = [];

    await service.plan('Light day', oneDay, profile, undefined, (event) => events.push(event));

    expect(events).toEqual([
      { type: ChatStreamEventType.Status, step: ChatStatusStep.SearchingBreakfasts },
      {
        type: ChatStreamEventType.MenuPending,
        days: 1,
        mealTypes: [MealType.Breakfast, MealType.Lunch, MealType.Snack, MealType.Dinner],
      },
      { type: ChatStreamEventType.Status, step: ChatStatusStep.PickingLunches },
      { type: ChatStreamEventType.Status, step: ChatStatusStep.CheckingConstraints },
    ]);
  });

  it('asks to fill in the profile first, without recipes or the model', async () => {
    await expect(service.plan('Light day', oneDay, null)).resolves.toEqual({
      type: ChatResponseType.Text,
      message: NO_PROFILE_REPLY,
    });
    expect(recipeService.getAllowed).not.toHaveBeenCalled();
    expect(llmService.generateStructuredResult).not.toHaveBeenCalled();
  });

  describe('retries', () => {
    it('sends the problems of an unknown recipe back and succeeds on the 2nd attempt', async () => {
      const wrong: MenuPlan = { ...plan, days: [{ dayIndex: 0, meals: { ...meals, lunch: 'x' } }] };
      llmService.generateStructuredResult
        .mockResolvedValueOnce(result(wrong))
        .mockResolvedValueOnce(result(plan));

      const onProgress = jest.fn();

      const response = await service.plan('Light day', oneDay, profile, undefined, onProgress);

      expect(response).toMatchObject({ type: ChatResponseType.MenuReady });
      expect(llmService.generateStructuredResult).toHaveBeenCalledTimes(2);
      expect(onProgress.mock.calls.map(([event]) => event.step ?? event.type)).toEqual([
        ChatStatusStep.SearchingBreakfasts,
        ChatStreamEventType.MenuPending,
        ChatStatusStep.PickingLunches,
        ChatStatusStep.CheckingConstraints,
        ChatStatusStep.PickingLunches,
        ChatStatusStep.CheckingConstraints,
      ]);
      expect(sentMessages(1).slice(1)).toEqual([
        { role: 'assistant', content: JSON.stringify(wrong) },
        {
          role: 'user',
          content: menuPlanRetryMessage([
            'dayIndex 0, lunch: "x" is not an id from the lunch recipes.',
          ]),
        },
      ]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('attempt 1 of 3 has 1 problem(s)'));
      expect(log).toHaveBeenCalledWith(
        'Menu of 1 days planned in 2 attempt(s) by gpt-test with menu-plan@v1',
      );
    });

    it.each([
      ['a recipe of another meal', [{ dayIndex: 0, meals: { ...meals, lunch: 'b1' } }]],
      ['too few days', []],
      [
        'a repeated dayIndex',
        [
          { dayIndex: 0, meals },
          { dayIndex: 0, meals },
        ],
      ],
    ])('retries %s', async (_case, days) => {
      llmService.generateStructuredResult
        .mockResolvedValueOnce(result({ ...plan, days }))
        .mockResolvedValueOnce(result(plan));

      await expect(service.plan('Light day', oneDay, profile)).resolves.toMatchObject({
        type: ChatResponseType.MenuReady,
      });
      expect(llmService.generateStructuredResult).toHaveBeenCalledTimes(2);
    });

    it('sends the errors of validateMenu back to the model', async () => {
      const vegan = buildRecipe({ id: 'rec-l2', name: 'Rice soup', mealType: MealType.Lunch });
      recipeService.getAllowed.mockResolvedValue([
        breakfast,
        buildRecipe({ id: 'rec-l', name: 'Rice bowl', dietType: [] }),
        vegan,
        dinner,
        snack,
      ]);
      llmService.generateStructuredResult
        .mockResolvedValueOnce(result(plan))
        .mockResolvedValueOnce(
          result({
            ...plan,
            days: [{ dayIndex: 0, meals: { ...meals, lunch: 'l2' } }],
          }),
        );

      const response = await service.plan('Light day', oneDay, profile);

      expect(sentMessages(1).at(-1)?.content).toBe(
        menuPlanRetryMessage(['Day 1, lunch: Rice bowl is not vegan.']),
      );
      expect(response).toMatchObject({
        type: ChatResponseType.MenuReady,
        menu: { days: [{ meals: [{}, { recipeId: 'rec-l2' }, {}, {}] }], issues: [] },
      });
    });

    it('fails with invalid output after the last attempt', async () => {
      llmService.generateStructuredResult.mockResolvedValue(result({ ...plan, days: [] }));

      await expect(service.plan('Light day', oneDay, profile)).rejects.toBeInstanceOf(
        AssistantInvalidOutputException,
      );
      expect(llmService.generateStructuredResult).toHaveBeenCalledTimes(MENU_PLAN_MAX_ATTEMPTS);
      expect(sentMessages(MENU_PLAN_MAX_ATTEMPTS - 1)).toHaveLength(
        1 + 2 * (MENU_PLAN_MAX_ATTEMPTS - 1),
      );
      expect(warn).toHaveBeenLastCalledWith(
        `Menu plan failed after ${MENU_PLAN_MAX_ATTEMPTS} attempts`,
      );
    });
  });
  describe('replan of a day', () => {
    const MEAL_TYPES = [MealType.Breakfast, MealType.Lunch, MealType.Snack, MealType.Dinner];
    /** A saved day of the recipes, one per meal in `MEAL_TYPES` order, 1.5 servings each. */
    const savedDay = (
      dayIndex: number,
      recipeIds: string[],
      date: Date | null = null,
    ): ResolvedDay => ({
      dayIndex,
      date,
      meals: recipeIds.map((recipeId, i) => ({
        mealType: MEAL_TYPES[i],
        servings: 1.5,
        recipeId,
        recipe: buildRecipeSnapshot({ id: recipeId, name: recipeId, mealType: MEAL_TYPES[i] }),
      })),
    });
    const previous = (): ResolvedDay[] => [
      savedDay(0, ['rec-b', 'rec-l', 'rec-s', 'rec-d']),
      savedDay(1, ['rec-b2', 'rec-l', 'rec-s', 'rec-d'], new Date('2026-11-03')),
      savedDay(2, ['rec-b3', 'rec-l', 'rec-s', 'rec-d']),
    ];
    const dayPlan: MenuDayPlan = { message: 'A new Tuesday.', meals };
    const dayResult = (output: MenuDayPlan): ModelResult<MenuDayPlan> => ({
      ...result(plan),
      output,
    });
    const threeDays: MenuRequest = { ...EMPTY_MENU_REQUEST, days: 3 };

    beforeEach(() => {
      recipeService.getAllowed.mockResolvedValue([
        breakfast,
        buildRecipe({ id: 'rec-b2', name: 'B2', mealType: MealType.Breakfast }),
        buildRecipe({ id: 'rec-b3', name: 'B3', mealType: MealType.Breakfast }),
        buildRecipe({ id: 'rec-b4', name: 'B4', mealType: MealType.Breakfast }),
        buildRecipe({ id: 'rec-b5', name: 'B5', mealType: MealType.Breakfast }),
        lunch,
        snack,
        dinner,
      ]);
      llmService.generateStructuredResult.mockResolvedValue(dayResult(dayPlan));
    });

    it('asks the model for the one day, among candidates without its own recipes and those of the other days', async () => {
      const abort = new AbortController();

      await service.replan(
        'Redo day 2',
        threeDays,
        profile,
        previous(),
        { days: [1], meals: [] },
        abort.signal,
      );

      const [messages, schema, options] = llmService.generateStructuredResult.mock.calls[0];
      const sent = JSON.parse((messages as Array<{ content: string }>)[0].content);
      expect(sent).toMatchObject({ request: 'Redo day 2', dayIndex: 1 });
      expect(sent.profile).toEqual(toModelProfile(profile));
      // rec-b and rec-b3 are on the other days, rec-b2 is the day's own.
      expect(sent.recipes.breakfast.map(({ name }: { name: string }) => name)).toEqual([
        'B4',
        'B5',
      ]);
      // The other days use the only lunch, snack and dinner: they stay rather than none.
      expect(sent.recipes.lunch.map(({ name }: { name: string }) => name)).toEqual(['Rice bowl']);
      expect(schema).toBe(MenuDayPlanSchema);
      expect(options).toEqual({
        prompt: MENU_DAY_PROMPT,
        maxOutputTokens: MENU_DAY_MAX_OUTPUT_TOKENS,
        abortSignal: abort.signal,
      });
    });

    it('leaves out the recipes earlier versions dropped while the meal has another', async () => {
      await service.replan(
        'Redo day 2',
        threeDays,
        profile,
        previous(),
        { days: [1], meals: [] },
        undefined,
        undefined,
        new Set(['rec-b4', 'rec-l']),
      );

      const [messages] = llmService.generateStructuredResult.mock.calls[0];
      const sent = JSON.parse((messages as Array<{ content: string }>)[0].content);
      expect(sent.recipes.breakfast.map(({ name }: { name: string }) => name)).toEqual(['B5']);
      // The only lunch stays rather than none.
      expect(sent.recipes.lunch.map(({ name }: { name: string }) => name)).toEqual(['Rice bowl']);
    });

    it('replaces only the day and copies the other days from the previous version as they are', async () => {
      const before = previous();
      const response = await service.replan('Redo day 2', threeDays, profile, before, {
        days: [1],
        meals: [],
      });

      expect(response.type).toBe(ChatResponseType.MenuReady);
      if (response.type !== ChatResponseType.MenuReady) {
        return;
      }
      expect(JSON.stringify(response.days[0])).toBe(JSON.stringify(previous()[0]));
      expect(JSON.stringify(response.days[2])).toBe(JSON.stringify(previous()[2]));
      expect(response.days[1]).toMatchObject({
        dayIndex: 1,
        date: new Date('2026-11-03'),
        meals: [
          { mealType: MealType.Breakfast, servings: 1, recipeId: 'rec-b4' },
          { mealType: MealType.Lunch, servings: 1, recipeId: 'rec-l' },
          { mealType: MealType.Snack, servings: 1, recipeId: 'rec-s' },
          { mealType: MealType.Dinner, servings: 1, recipeId: 'rec-d' },
        ],
      });
      expect(response).toMatchObject({
        message: 'A new Tuesday.',
        menu: {
          days: [
            { dayIndex: 0, meals: [{ recipeId: 'rec-b', servings: 1.5 }, {}, {}, {}] },
            {
              dayIndex: 1,
              date: '2026-11-03',
              meals: [{ recipeId: 'rec-b4', servings: 1 }, {}, {}, {}],
            },
            { dayIndex: 2, meals: [{ recipeId: 'rec-b3', servings: 1.5 }, {}, {}, {}] },
          ],
        },
        generatedWith: { modelId, prompt: 'menu-day@v1' },
      });
      expect(log).toHaveBeenCalledWith(
        '1 day(s) and 0 meal(s) of 3 days replaced in 1 attempt(s) by gpt-test with menu-day@v1',
      );
    });

    it('fits the servings of the new day only to the calories of the request', async () => {
      const response = await service.replan(
        'Redo day 2',
        { ...threeDays, caloriesKcal: 1040 },
        profile,
        previous(),
        { days: [1], meals: [] },
      );

      expect(response).toMatchObject({
        days: [
          { meals: [{ servings: 1.5 }, {}, {}, {}] },
          { meals: [{ servings: 2 }, { servings: 2 }, { servings: 2 }, { servings: 2 }] },
          { meals: [{ servings: 1.5 }, {}, {}, {}] },
        ],
      });
    });

    it('tells the stream the shape of the whole menu', async () => {
      const onProgress = jest.fn();

      await service.replan(
        'Redo day 2',
        threeDays,
        profile,
        previous(),
        { days: [1], meals: [] },
        undefined,
        onProgress,
      );

      expect(onProgress).toHaveBeenCalledWith({
        type: ChatStreamEventType.MenuPending,
        days: 3,
        mealTypes: MEAL_TYPES,
      });
    });

    it('validates the whole menu and sends the errors on the new day back to the model', async () => {
      recipeService.getAllowed.mockResolvedValue([
        buildRecipe({
          id: 'rec-b4',
          name: 'Not vegan',
          mealType: MealType.Breakfast,
          dietType: [],
        }),
        buildRecipe({ id: 'rec-b5', name: 'B5', mealType: MealType.Breakfast }),
        lunch,
        snack,
        dinner,
      ]);
      llmService.generateStructuredResult
        .mockResolvedValueOnce(dayResult(dayPlan))
        .mockResolvedValueOnce(dayResult({ ...dayPlan, meals: { ...meals, breakfast: 'b2' } }));

      const response = await service.replan('Redo day 2', threeDays, profile, previous(), {
        days: [1],
        meals: [],
      });

      expect(sentMessages(1).at(-1)?.content).toBe(
        menuDayRetryMessage(['Day 2, breakfast: Not vegan is not vegan.']),
      );
      expect(response).toMatchObject({
        days: [{}, { meals: [{ recipeId: 'rec-b5' }, {}, {}, {}] }, {}],
        menu: { issues: [] },
      });
    });

    it('fails with invalid output after the last attempt', async () => {
      llmService.generateStructuredResult.mockResolvedValue(
        dayResult({ ...dayPlan, meals: { ...meals, lunch: 'l9' } }),
      );

      await expect(
        service.replan('Redo day 2', threeDays, profile, previous(), { days: [1], meals: [] }),
      ).rejects.toBeInstanceOf(AssistantInvalidOutputException);
      expect(llmService.generateStructuredResult).toHaveBeenCalledTimes(MENU_PLAN_MAX_ATTEMPTS);
    });

    it('asks to fill in the profile when there is none', async () => {
      await expect(
        service.replan('Redo day 2', threeDays, null, previous(), { days: [1], meals: [] }),
      ).resolves.toEqual({ type: ChatResponseType.Text, message: NO_PROFILE_REPLY });
      expect(llmService.generateStructuredResult).not.toHaveBeenCalled();
    });

    it('rejects a day the menu does not have', async () => {
      await expect(
        service.replan('Redo day 5', threeDays, profile, previous(), { days: [4], meals: [] }),
      ).rejects.toThrow('The menu has no day 4');
    });
  });

  describe('replan of a meal', () => {
    const MEAL_TYPES = [MealType.Breakfast, MealType.Lunch, MealType.Snack, MealType.Dinner];
    /** A saved day of the recipes, one per meal in `MEAL_TYPES` order, 1.5 servings (195 kcal) each. */
    const savedDay = (dayIndex: number, recipeIds: string[]): ResolvedDay => ({
      dayIndex,
      date: null,
      meals: recipeIds.map((recipeId, i) => ({
        mealType: MEAL_TYPES[i],
        servings: 1.5,
        recipeId,
        recipe: buildRecipeSnapshot({ id: recipeId, name: recipeId, mealType: MEAL_TYPES[i] }),
      })),
    });
    const previous = (): ResolvedDay[] => [
      savedDay(0, ['rec-b', 'rec-l', 'rec-s', 'rec-d']),
      savedDay(1, ['rec-b', 'rec-l', 'rec-s', 'rec-d2']),
      savedDay(2, ['rec-b', 'rec-l', 'rec-s', 'rec-d3']),
    ];
    const mealPlan: MenuMealPlan = { message: 'A new dinner.', recipe: 'd1' };
    const mealResult = (output: MenuMealPlan): ModelResult<MenuMealPlan> => ({
      ...result(plan),
      output,
    });
    const threeDays: MenuRequest = { ...EMPTY_MENU_REQUEST, days: 3 };
    /** 1300 kcal a serving: too much for any day of 800 kcal. */
    const huge = buildRecipe({
      id: 'rec-huge',
      name: 'Huge',
      mealType: MealType.Dinner,
      ingredients: [buildIngredient({ quantityG: new Prisma.Decimal(2000) })],
    });
    const replan = (
      request: MenuRequest = threeDays,
      before: ResolvedDay[] = previous(),
    ): Promise<ChatResponse> =>
      service.replan('Another dinner', request, profile, before, {
        days: [],
        meals: [{ dayIndex: 1, mealType: MealType.Dinner }],
      });

    beforeEach(() => {
      recipeService.getAllowed.mockResolvedValue([
        breakfast,
        lunch,
        snack,
        dinner,
        buildRecipe({ id: 'rec-d2', name: 'D2', mealType: MealType.Dinner }),
        buildRecipe({ id: 'rec-d3', name: 'D3', mealType: MealType.Dinner }),
        buildRecipe({ id: 'rec-d4', name: 'D4', mealType: MealType.Dinner }),
        huge,
      ]);
      llmService.generateStructuredResult.mockResolvedValue(mealResult(mealPlan));
    });

    it('asks the model for the one meal, among the recipes of that meal not in the menu yet', async () => {
      const abort = new AbortController();

      await service.replan(
        'Another dinner',
        threeDays,
        profile,
        previous(),
        { days: [], meals: [{ dayIndex: 1, mealType: MealType.Dinner }] },
        abort.signal,
      );

      const [messages, schema, options] = llmService.generateStructuredResult.mock.calls[0];
      const sent = JSON.parse((messages as Array<{ content: string }>)[0].content);
      expect(sent).toMatchObject({
        request: 'Another dinner',
        dayIndex: 1,
        mealType: MealType.Dinner,
        day: [
          { mealType: MealType.Breakfast, name: 'rec-b' },
          { mealType: MealType.Lunch, name: 'rec-l' },
          { mealType: MealType.Snack, name: 'rec-s' },
        ],
      });
      expect(sent.profile).toEqual(toModelProfile(profile));
      expect(sent.recipes.map(({ name }: { name: string }) => name)).toEqual(['D4', 'Huge']);
      expect(schema).toBe(MenuMealPlanSchema);
      expect(options).toEqual({
        prompt: MENU_MEAL_PROMPT,
        maxOutputTokens: MENU_MEAL_MAX_OUTPUT_TOKENS,
        abortSignal: abort.signal,
      });
    });

    it('leaves out the recipes that cannot keep the day within its calories', async () => {
      await replan({ ...threeDays, caloriesKcal: 800 });

      const sent = JSON.parse(sentMessages()[0].content);
      expect(sent.recipes.map(({ name }: { name: string }) => name)).toEqual(['D4']);
    });

    it('keeps every recipe when none keeps the day within its calories', async () => {
      await replan({ ...threeDays, caloriesKcal: 100 });

      const sent = JSON.parse(sentMessages()[0].content);
      expect(sent.recipes.map(({ name }: { name: string }) => name)).toEqual(['D4', 'Huge']);
    });

    it('offers a recipe of another day rather than none, but never the old one while there is another', async () => {
      recipeService.getAllowed.mockResolvedValue([
        breakfast,
        lunch,
        snack,
        buildRecipe({ id: 'rec-d', name: 'D1', mealType: MealType.Dinner }),
        buildRecipe({ id: 'rec-d2', name: 'D2', mealType: MealType.Dinner }),
      ]);

      await replan();

      const sent = JSON.parse(sentMessages()[0].content);
      expect(sent.recipes.map(({ name }: { name: string }) => name)).toEqual(['D1']);
    });

    it('replaces only the meal and copies every other meal of the menu as it is', async () => {
      const response = await replan();

      expect(response.type).toBe(ChatResponseType.MenuReady);
      if (response.type !== ChatResponseType.MenuReady) {
        return;
      }
      expect(JSON.stringify(response.days[0])).toBe(JSON.stringify(previous()[0]));
      expect(JSON.stringify(response.days[2])).toBe(JSON.stringify(previous()[2]));
      expect(JSON.stringify(response.days[1].meals.slice(0, 3))).toBe(
        JSON.stringify(previous()[1].meals.slice(0, 3)),
      );
      expect(response.days[1].meals[3]).toMatchObject({
        mealType: MealType.Dinner,
        servings: 1,
        recipeId: 'rec-d4',
        recipe: { name: 'D4' },
      });
      expect(response).toMatchObject({
        message: 'A new dinner.',
        menu: { days: [{}, { meals: [{}, {}, {}, { recipeId: 'rec-d4' }] }, {}] },
        generatedWith: { modelId, prompt: 'menu-meal@v1' },
      });
      expect(log).toHaveBeenCalledWith(
        '0 day(s) and 1 meal(s) of 3 days replaced in 1 attempt(s) by gpt-test with menu-meal@v1',
      );
    });

    it('sets the servings of the new meal so that the day is closest to its calories', async () => {
      // The other meals have 585 kcal; 1.75 servings of 130 kcal bring the day to 812.5 kcal.
      const response = await replan({ ...threeDays, caloriesKcal: 800 });

      expect(response).toMatchObject({
        days: [
          {},
          { meals: [{ servings: 1.5 }, { servings: 1.5 }, { servings: 1.5 }, { servings: 1.75 }] },
          {},
        ],
      });
    });

    it('tells the stream the shape of the whole menu', async () => {
      const onProgress = jest.fn();

      await service.replan(
        'Another dinner',
        threeDays,
        profile,
        previous(),
        { days: [], meals: [{ dayIndex: 1, mealType: MealType.Dinner }] },
        undefined,
        onProgress,
      );

      expect(onProgress).toHaveBeenCalledWith({
        type: ChatStreamEventType.MenuPending,
        days: 3,
        mealTypes: MEAL_TYPES,
      });
    });

    it('validates the whole menu and sends the errors on the new meal back to the model', async () => {
      recipeService.getAllowed.mockResolvedValue([
        breakfast,
        lunch,
        snack,
        buildRecipe({ id: 'rec-d5', name: 'Not vegan', mealType: MealType.Dinner, dietType: [] }),
        buildRecipe({ id: 'rec-d6', name: 'D6', mealType: MealType.Dinner }),
      ]);
      llmService.generateStructuredResult
        .mockResolvedValueOnce(mealResult(mealPlan))
        .mockResolvedValueOnce(mealResult({ ...mealPlan, recipe: 'd2' }));

      const response = await replan();

      expect(sentMessages(1).at(-1)?.content).toBe(
        menuMealRetryMessage(['Day 2, dinner: Not vegan is not vegan.']),
      );
      expect(response).toMatchObject({
        days: [{}, { meals: [{}, {}, {}, { recipeId: 'rec-d6' }] }, {}],
        menu: { issues: [] },
      });
    });

    it('fails with invalid output after the last attempt', async () => {
      llmService.generateStructuredResult.mockResolvedValue(
        mealResult({ ...mealPlan, recipe: 'd9' }),
      );

      await expect(replan()).rejects.toBeInstanceOf(AssistantInvalidOutputException);
      expect(llmService.generateStructuredResult).toHaveBeenCalledTimes(MENU_PLAN_MAX_ATTEMPTS);
      expect(sentMessages(1).at(-1)?.content).toBe(
        menuMealRetryMessage(['dayIndex 1, dinner: "d9" is not an id from the dinner recipes.']),
      );
    });

    it('asks to fill in the profile when there is none', async () => {
      await expect(
        service.replan('Another dinner', threeDays, null, previous(), {
          days: [],
          meals: [{ dayIndex: 1, mealType: MealType.Dinner }],
        }),
      ).resolves.toEqual({ type: ChatResponseType.Text, message: NO_PROFILE_REPLY });
      expect(llmService.generateStructuredResult).not.toHaveBeenCalled();
    });

    it('rejects a day the menu does not have', async () => {
      await expect(
        service.replan('Another', threeDays, profile, previous(), {
          days: [],
          meals: [{ dayIndex: 4, mealType: MealType.Dinner }],
        }),
      ).rejects.toThrow('The menu has no dinner on day 4');
    });

    it('rejects a meal the day does not have', async () => {
      const before = previous();
      before[1].meals = before[1].meals.filter(({ mealType }) => mealType !== MealType.Snack);

      await expect(
        service.replan('Another', threeDays, profile, before, {
          days: [],
          meals: [{ dayIndex: 1, mealType: MealType.Snack }],
        }),
      ).rejects.toThrow('The menu has no snack on day 1');
    });
  });

  describe('replan of several parts', () => {
    const MEAL_TYPES = [MealType.Breakfast, MealType.Lunch, MealType.Snack, MealType.Dinner];
    const PREFIXES = ['b', 'l', 's', 'd'];
    /** Five recipes of every meal, `rec-b1` ("B1") to `rec-d5`, 130 kcal a serving each. */
    const allowed = MEAL_TYPES.flatMap((mealType, i) =>
      [1, 2, 3, 4, 5].map((n) =>
        buildRecipe({
          id: `rec-${PREFIXES[i]}${n}`,
          name: `${PREFIXES[i].toUpperCase()}${n}`,
          mealType,
        }),
      ),
    );
    /** A saved day of the `n`th recipe of every meal, 1.5 servings (195 kcal) each. */
    const savedDay = (dayIndex: number, n: number): ResolvedDay => ({
      dayIndex,
      date: null,
      meals: MEAL_TYPES.map((mealType, i) => ({
        mealType,
        servings: 1.5,
        recipeId: `rec-${PREFIXES[i]}${n}`,
        recipe: buildRecipeSnapshot({ id: `rec-${PREFIXES[i]}${n}`, name: `R${n}`, mealType }),
      })),
    });
    const previous = (): ResolvedDay[] => [savedDay(0, 1), savedDay(1, 2), savedDay(2, 3)];
    const threeDays: MenuRequest = { ...EMPTY_MENU_REQUEST, days: 3 };
    const answer = <T>(output: T): ModelResult<T> =>
      ({ ...result(plan), output }) as unknown as ModelResult<T>;
    const dayOf = (label: string, message: string): ModelResult<MenuDayPlan> =>
      answer({
        message,
        meals: {
          breakfast: `b${label}`,
          lunch: `l${label}`,
          snack: `s${label}`,
          dinner: `d${label}`,
        },
      });
    const sentNames = (call: number, mealType: MealType): string[] =>
      JSON.parse(sentMessages(call)[0].content).recipes[mealType].map(
        ({ name }: { name: string }) => name,
      );

    beforeEach(() => {
      recipeService.getAllowed.mockResolvedValue(allowed);
    });

    it('plans the days in order in one menu, none with a recipe of another day or its own', async () => {
      llmService.generateStructuredResult
        .mockResolvedValueOnce(dayOf('1', 'A new Monday.'))
        .mockResolvedValueOnce(dayOf('1', 'A new Wednesday.'));

      const response = await service.replan(
        'Redo Monday and Wednesday',
        threeDays,
        profile,
        previous(),
        {
          days: [0, 2],
          meals: [],
        },
      );

      // Monday: without its 1, Tuesday's 2 and Wednesday's 3.
      expect(sentNames(0, MealType.Breakfast)).toEqual(['B4', 'B5']);
      // Wednesday: without its 3, Tuesday's 2, the new Monday's 4 and the old Monday's 1.
      expect(sentNames(1, MealType.Breakfast)).toEqual(['B5']);
      expect(response.type).toBe(ChatResponseType.MenuReady);
      if (response.type !== ChatResponseType.MenuReady) {
        return;
      }
      expect(response.days.map(({ meals: [first] }) => first.recipeId)).toEqual([
        'rec-b4',
        'rec-b2',
        'rec-b5',
      ]);
      expect(JSON.stringify(response.days[1])).toBe(JSON.stringify(previous()[1]));
      expect(response).toMatchObject({
        message: 'A new Monday. A new Wednesday.',
        generatedWith: { modelId, prompt: 'menu-day@v1' },
      });
      expect(log).toHaveBeenCalledWith(
        '2 day(s) and 0 meal(s) of 3 days replaced in 2 attempt(s) by gpt-test with menu-day@v1',
      );
    });

    it('replaces the meals after the days, among the recipes not in the new menu', async () => {
      llmService.generateStructuredResult
        .mockResolvedValueOnce(dayOf('1', 'A new Monday.'))
        .mockResolvedValueOnce(answer<MenuMealPlan>({ message: 'A new dinner.', recipe: 'd1' }));

      const response = await service.replan(
        'Redo Monday and the dinner on Tuesday',
        threeDays,
        profile,
        previous(),
        {
          days: [0],
          meals: [{ dayIndex: 1, mealType: MealType.Dinner }],
        },
      );

      expect(llmService.generateStructuredResult.mock.calls[1][1]).toBe(MenuMealPlanSchema);
      // Not the old D2, nor D3 of Wednesday, nor D4 of the new Monday, nor D1 of the old one.
      expect(
        JSON.parse(sentMessages(1)[0].content).recipes.map(({ name }: { name: string }) => name),
      ).toEqual(['D5']);
      expect(response.type).toBe(ChatResponseType.MenuReady);
      if (response.type !== ChatResponseType.MenuReady) {
        return;
      }
      expect(response.days[0].meals.map(({ recipeId }) => recipeId)).toEqual([
        'rec-b4',
        'rec-l4',
        'rec-s4',
        'rec-d4',
      ]);
      expect(JSON.stringify(response.days[1].meals.slice(0, 3))).toBe(
        JSON.stringify(previous()[1].meals.slice(0, 3)),
      );
      expect(response.days[1].meals[3].recipeId).toBe('rec-d5');
      expect(JSON.stringify(response.days[2])).toBe(JSON.stringify(previous()[2]));
      expect(response).toMatchObject({
        message: 'A new Monday. A new dinner.',
        generatedWith: { prompt: 'menu-day@v1, menu-meal@v1' },
      });
    });

    /** `previous` with Bacon, which is not vegan, for breakfast on the `dayIndexes`. */
    const withBacon = (...dayIndexes: number[]): ResolvedDay[] => {
      const days = previous();
      dayIndexes.forEach((dayIndex) => {
        days[dayIndex].meals[0].recipe = buildRecipeSnapshot({
          id: days[dayIndex].meals[0].recipeId,
          name: 'Bacon',
          dietType: [],
          mealType: MealType.Breakfast,
        });
      });
      return days;
    };

    it('replaces a meal of another day that breaks the rules too', async () => {
      llmService.generateStructuredResult
        .mockResolvedValueOnce(dayOf('1', 'A new Tuesday.'))
        .mockResolvedValueOnce(answer<MenuMealPlan>({ message: 'A new breakfast.', recipe: 'b1' }));
      const before = withBacon(0);

      const response = await service.replan('Redo Tuesday', threeDays, profile, before, {
        days: [1],
        meals: [],
      });

      expect(llmService.generateStructuredResult).toHaveBeenCalledTimes(2);
      expect(llmService.generateStructuredResult.mock.calls[1][1]).toBe(MenuMealPlanSchema);
      expect(response.type).toBe(ChatResponseType.MenuReady);
      if (response.type !== ChatResponseType.MenuReady) {
        return;
      }
      expect(response.days[0].meals[0].recipe.name).not.toBe('Bacon');
      expect(JSON.stringify(response.days[0].meals.slice(1))).toBe(
        JSON.stringify(before[0].meals.slice(1)),
      );
      expect(JSON.stringify(response.days[2])).toBe(JSON.stringify(before[2]));
      expect(
        response.menu.issues.filter(({ severity }) => severity === MenuIssueSeverity.Error),
      ).toEqual([]);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(
          '1 day(s) and 1 meal(s) of 3 days replaced (1 meal(s) breaking the rules)',
        ),
      );
    });

    it('plans the whole menu again when the rest of it breaks the rules', async () => {
      llmService.generateStructuredResult.mockResolvedValue(answer({ message: 'x', days: [] }));
      const before = previous();
      [0, 2].forEach((dayIndex) =>
        before[dayIndex].meals.forEach((meal) => {
          meal.recipe = { ...meal.recipe, dietType: [] };
        }),
      );

      await service
        .replan('Redo Tuesday', threeDays, profile, before, { days: [1], meals: [] })
        .catch(() => undefined);

      const [messages, schema, options] = llmService.generateStructuredResult.mock.calls[0];
      expect(schema).toBe(MenuPlanSchema);
      expect(options).toMatchObject({ prompt: MENU_PLAN_PROMPT });
      expect(JSON.parse((messages as Array<{ content: string }>)[0].content)).toMatchObject({
        days: 3,
      });
      expect(log).toHaveBeenCalledWith(
        '8 meal(s) of 3 days break the rules: the whole menu is planned again',
      );
    });

    it('fits every meal of a day to the meals replaced before it', async () => {
      llmService.generateStructuredResult
        .mockResolvedValueOnce(answer<MenuMealPlan>({ message: 'A new lunch.', recipe: 'l1' }))
        .mockResolvedValueOnce(answer<MenuMealPlan>({ message: 'A new dinner.', recipe: 'd1' }));

      const response = await service.replan(
        'Another lunch and dinner on Tuesday',
        { ...threeDays, caloriesKcal: 800 },
        profile,
        previous(),
        {
          days: [],
          meals: [
            { dayIndex: 1, mealType: MealType.Lunch },
            { dayIndex: 1, mealType: MealType.Dinner },
          ],
        },
      );

      // Lunch: 585 kcal of the others, 1.75 servings make 812.5 kcal. Dinner: 617.5 kcal of the
      // others with the new lunch, 1.5 servings make 812.5 kcal again.
      expect(response).toMatchObject({
        days: [
          {},
          { meals: [{ servings: 1.5 }, { servings: 1.75 }, { servings: 1.5 }, { servings: 1.5 }] },
          {},
        ],
        menu: { issues: [] },
      });
    });

    it('asks for no other part once one fails', async () => {
      llmService.generateStructuredResult.mockResolvedValue(dayOf('9', 'Unknown.'));

      await expect(
        service.replan('Redo Monday and Wednesday', threeDays, profile, previous(), {
          days: [0, 2],
          meals: [],
        }),
      ).rejects.toBeInstanceOf(AssistantInvalidOutputException);
      expect(llmService.generateStructuredResult).toHaveBeenCalledTimes(MENU_PLAN_MAX_ATTEMPTS);
    });
  });
});

describe('offeredRecipes', () => {
  it('groups the offered recipes that are still allowed by meal, in the order offered', () => {
    const offer = {
      wishes: 'sushi',
      recipes: [
        { id: 'a', name: 'A', mealType: MealType.Lunch },
        { id: 'b', name: 'B', mealType: MealType.Dinner },
        { id: 'c', name: 'C', mealType: MealType.Lunch },
      ],
    };

    expect(offeredRecipes(offer, [{ id: 'c' }, { id: 'a' }])).toEqual({ lunch: ['a', 'c'] });
  });
});
