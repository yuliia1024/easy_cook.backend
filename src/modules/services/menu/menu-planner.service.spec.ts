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
  MENU_PLAN_PROMPT,
  MENU_PLAN_MAX_ATTEMPTS,
  menuPlanMaxOutputTokens,
  menuPlanRetryMessage,
  NO_PROFILE_REPLY,
} from '../../../common/constants';
import { MenuPlan, MenuPlanSchema, MenuRequest } from '../../../common/contracts';
import { AssistantInvalidOutputException } from '../../../common/exceptions';
import { ChatProgressEvent, ProfileContext } from '../../../common/types';
import { ModelResult, OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { Prisma } from '../../../generated/prisma/client';
import { createMock } from '../../../test/create-mock';
import { buildFoodItem, buildIngredient, buildRecipe, PROFILE_ID } from '../../../test/fixtures';
import { NutritionService } from '../nutrition/nutrition.service';
import { toModelProfile } from '../profile-context/model-profile';
import { RecipeService } from '../recipe/recipe.service';
import { MenuComposer } from './menu-composer';
import { EMPTY_MENU_REQUEST } from './menu-request';
import { MenuPlannerService } from './menu-planner.service';

describe('MenuPlannerService', () => {
  let recipeService: jest.Mocked<RecipeService>;
  let openAiService: jest.Mocked<OpenAiService>;
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
    openAiService.generateStructuredResult.mock.calls[call][0] as Array<{
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
    openAiService = createMock<OpenAiService>();
    openAiService.generateStructuredResult.mockResolvedValue(result(plan));
    service = new MenuPlannerService(
      recipeService,
      new NutritionService(),
      openAiService,
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
    expect(openAiService.generateStructuredResult).toHaveBeenCalledWith(
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
    openAiService.generateStructuredResult.mockResolvedValue(
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
    expect(openAiService.generateStructuredResult.mock.calls[0][2].maxOutputTokens).toBe(
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
    openAiService.generateStructuredResult.mockResolvedValue(
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
    expect(openAiService.generateStructuredResult).toHaveBeenCalledTimes(1);
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
      expect(openAiService.generateStructuredResult).not.toHaveBeenCalled();
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
      expect(openAiService.generateStructuredResult).toHaveBeenCalled();
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
    expect(openAiService.generateStructuredResult).not.toHaveBeenCalled();
  });

  describe('retries', () => {
    it('sends the problems of an unknown recipe back and succeeds on the 2nd attempt', async () => {
      const wrong: MenuPlan = { ...plan, days: [{ dayIndex: 0, meals: { ...meals, lunch: 'x' } }] };
      openAiService.generateStructuredResult
        .mockResolvedValueOnce(result(wrong))
        .mockResolvedValueOnce(result(plan));

      const onProgress = jest.fn();

      const response = await service.plan('Light day', oneDay, profile, undefined, onProgress);

      expect(response).toMatchObject({ type: ChatResponseType.MenuReady });
      expect(openAiService.generateStructuredResult).toHaveBeenCalledTimes(2);
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
      openAiService.generateStructuredResult
        .mockResolvedValueOnce(result({ ...plan, days }))
        .mockResolvedValueOnce(result(plan));

      await expect(service.plan('Light day', oneDay, profile)).resolves.toMatchObject({
        type: ChatResponseType.MenuReady,
      });
      expect(openAiService.generateStructuredResult).toHaveBeenCalledTimes(2);
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
      openAiService.generateStructuredResult
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
      openAiService.generateStructuredResult.mockResolvedValue(result({ ...plan, days: [] }));

      await expect(service.plan('Light day', oneDay, profile)).rejects.toBeInstanceOf(
        AssistantInvalidOutputException,
      );
      expect(openAiService.generateStructuredResult).toHaveBeenCalledTimes(MENU_PLAN_MAX_ATTEMPTS);
      expect(sentMessages(MENU_PLAN_MAX_ATTEMPTS - 1)).toHaveLength(
        1 + 2 * (MENU_PLAN_MAX_ATTEMPTS - 1),
      );
      expect(warn).toHaveBeenLastCalledWith(
        `Menu plan failed after ${MENU_PLAN_MAX_ATTEMPTS} attempts`,
      );
    });
  });
});
