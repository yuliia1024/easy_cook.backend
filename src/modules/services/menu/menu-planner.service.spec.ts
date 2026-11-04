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
  menuDayRetryMessage,
  menuMealRetryMessage,
  menuPlanMaxOutputTokens,
  menuPlanRetryMessage,
  NO_PROFILE_REPLY,
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
import { ModelResult, OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { Prisma } from '../../../generated/prisma/client';
import { createMock } from '../../../test/create-mock';
import {
  buildFoodItem,
  buildIngredient,
  buildRecipe,
  buildRecipeSnapshot,
  PROFILE_ID,
} from '../../../test/fixtures';
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
  describe('replanDay', () => {
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
        lunch,
        snack,
        dinner,
      ]);
      openAiService.generateStructuredResult.mockResolvedValue(dayResult(dayPlan));
    });

    it('asks the model for the one day, among candidates without the recipes of the other days', async () => {
      const abort = new AbortController();

      await service.replanDay('Redo day 2', threeDays, profile, previous(), 1, abort.signal);

      const [messages, schema, options] = openAiService.generateStructuredResult.mock.calls[0];
      const sent = JSON.parse((messages as Array<{ content: string }>)[0].content);
      expect(sent).toMatchObject({ request: 'Redo day 2', dayIndex: 1 });
      expect(sent.profile).toEqual(toModelProfile(profile));
      // rec-b and rec-b3 are on the other days; the day's own rec-b2 may come back.
      expect(sent.recipes.breakfast.map(({ name }: { name: string }) => name)).toEqual([
        'B2',
        'B4',
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

    it('replaces only the day and copies the other days from the previous version as they are', async () => {
      const before = previous();
      const response = await service.replanDay('Redo day 2', threeDays, profile, before, 1);

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
          { mealType: MealType.Breakfast, servings: 1, recipeId: 'rec-b2' },
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
              meals: [{ recipeId: 'rec-b2', servings: 1 }, {}, {}, {}],
            },
            { dayIndex: 2, meals: [{ recipeId: 'rec-b3', servings: 1.5 }, {}, {}, {}] },
          ],
        },
        generatedWith: { modelId, prompt: 'menu-day@v1' },
      });
      expect(log).toHaveBeenCalledWith(
        'Day 2 of 3 planned again in 1 attempt(s) by gpt-test with menu-day@v1',
      );
    });

    it('fits the servings of the new day only to the calories of the request', async () => {
      const response = await service.replanDay(
        'Redo day 2',
        { ...threeDays, caloriesKcal: 1040 },
        profile,
        previous(),
        1,
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

      await service.replanDay(
        'Redo day 2',
        threeDays,
        profile,
        previous(),
        1,
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
      openAiService.generateStructuredResult
        .mockResolvedValueOnce(dayResult(dayPlan))
        .mockResolvedValueOnce(dayResult({ ...dayPlan, meals: { ...meals, breakfast: 'b2' } }));

      const response = await service.replanDay('Redo day 2', threeDays, profile, previous(), 1);

      expect(sentMessages(1).at(-1)?.content).toBe(
        menuDayRetryMessage(['Day 2, breakfast: Not vegan is not vegan.']),
      );
      expect(response).toMatchObject({
        days: [{}, { meals: [{ recipeId: 'rec-b5' }, {}, {}, {}] }, {}],
        menu: { issues: [] },
      });
    });

    it('keeps the errors of the other days in the issues without sending them back', async () => {
      const before = previous();
      before[0].meals[0].recipe = buildRecipeSnapshot({ id: 'rec-b', name: 'Bacon', dietType: [] });

      const response = await service.replanDay('Redo day 2', threeDays, profile, before, 1);

      expect(openAiService.generateStructuredResult).toHaveBeenCalledTimes(1);
      expect(response).toMatchObject({
        menu: {
          issues: [
            {
              severity: MenuIssueSeverity.Error,
              code: MenuIssueCode.DietViolation,
              dayIndex: 0,
            },
          ],
        },
      });
    });

    it('fails with invalid output after the last attempt', async () => {
      openAiService.generateStructuredResult.mockResolvedValue(
        dayResult({ ...dayPlan, meals: { ...meals, lunch: 'l9' } }),
      );

      await expect(
        service.replanDay('Redo day 2', threeDays, profile, previous(), 1),
      ).rejects.toBeInstanceOf(AssistantInvalidOutputException);
      expect(openAiService.generateStructuredResult).toHaveBeenCalledTimes(MENU_PLAN_MAX_ATTEMPTS);
    });

    it('asks to fill in the profile when there is none', async () => {
      await expect(
        service.replanDay('Redo day 2', threeDays, null, previous(), 1),
      ).resolves.toEqual({ type: ChatResponseType.Text, message: NO_PROFILE_REPLY });
      expect(openAiService.generateStructuredResult).not.toHaveBeenCalled();
    });

    it('rejects a day the menu does not have', async () => {
      await expect(
        service.replanDay('Redo day 5', threeDays, profile, previous(), 4),
      ).rejects.toThrow('The menu has no day 4');
    });
  });

  describe('replanMeal', () => {
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
      service.replanMeal('Another dinner', request, profile, before, 1, MealType.Dinner);

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
      openAiService.generateStructuredResult.mockResolvedValue(mealResult(mealPlan));
    });

    it('asks the model for the one meal, among the recipes of that meal not in the menu yet', async () => {
      const abort = new AbortController();

      await service.replanMeal(
        'Another dinner',
        threeDays,
        profile,
        previous(),
        1,
        MealType.Dinner,
        abort.signal,
      );

      const [messages, schema, options] = openAiService.generateStructuredResult.mock.calls[0];
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
        'The dinner of day 2 of 3 replaced in 1 attempt(s) by gpt-test with menu-meal@v1',
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

      await service.replanMeal(
        'Another dinner',
        threeDays,
        profile,
        previous(),
        1,
        MealType.Dinner,
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
      openAiService.generateStructuredResult
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

    it('keeps the errors of the other meals in the issues without sending them back', async () => {
      const before = previous();
      before[1].meals[0].recipe = buildRecipeSnapshot({ id: 'rec-b', name: 'Bacon', dietType: [] });

      const response = await replan(threeDays, before);

      expect(openAiService.generateStructuredResult).toHaveBeenCalledTimes(1);
      expect(response).toMatchObject({
        menu: {
          issues: [
            {
              severity: MenuIssueSeverity.Error,
              code: MenuIssueCode.DietViolation,
              dayIndex: 1,
              position: 0,
            },
          ],
        },
      });
    });

    it('fails with invalid output after the last attempt', async () => {
      openAiService.generateStructuredResult.mockResolvedValue(
        mealResult({ ...mealPlan, recipe: 'd9' }),
      );

      await expect(replan()).rejects.toBeInstanceOf(AssistantInvalidOutputException);
      expect(openAiService.generateStructuredResult).toHaveBeenCalledTimes(MENU_PLAN_MAX_ATTEMPTS);
      expect(sentMessages(1).at(-1)?.content).toBe(
        menuMealRetryMessage(['dayIndex 1, dinner: "d9" is not an id from the dinner recipes.']),
      );
    });

    it('asks to fill in the profile when there is none', async () => {
      await expect(
        service.replanMeal('Another dinner', threeDays, null, previous(), 1, MealType.Dinner),
      ).resolves.toEqual({ type: ChatResponseType.Text, message: NO_PROFILE_REPLY });
      expect(openAiService.generateStructuredResult).not.toHaveBeenCalled();
    });

    it('rejects a day the menu does not have', async () => {
      await expect(
        service.replanMeal('Another', threeDays, profile, previous(), 4, MealType.Dinner),
      ).rejects.toThrow('The menu has no dinner on day 4');
    });

    it('rejects a meal the day does not have', async () => {
      const before = previous();
      before[1].meals = before[1].meals.filter(({ mealType }) => mealType !== MealType.Snack);

      await expect(
        service.replanMeal('Another', threeDays, profile, before, 1, MealType.Snack),
      ).rejects.toThrow('The menu has no snack on day 1');
    });
  });
});
