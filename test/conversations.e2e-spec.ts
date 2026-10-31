import request from 'supertest';
import { addLentilStew, createMenuWorld, seedMenu } from './menu-fixtures';
import { readStream } from './menu-stream';
import { EMPTY_MENU_REQUEST } from '../src/modules/services/menu/menu-request';
import {
  ASSISTANT_INVALID_OUTPUT_REPLY,
  ASSISTANT_UNAVAILABLE_REPLY,
  ChatErrorCode,
  CLARIFICATION_REPLY,
  DietTag,
  Intent,
  MealType,
  MENU_PLAN_FAILED_REPLY,
  MENU_PLAN_MAX_ATTEMPTS,
  NO_MENU_RECIPES_REPLY,
  OUT_OF_SCOPE_REPLY,
} from '../src/common/constants';
import {
  createTestApp,
  FAKE_OPEN_AI_DELTAS,
  fakeMenuPlan,
  fakeOpenAiState,
  resetDatabase,
  resetFakeOpenAi,
  resetRateLimits,
  TestApp,
} from './test-app';

describe('/api/conversations (e2e)', () => {
  let ctx: TestApp;
  const http = () => request(ctx.app.getHttpServer());
  const start = async (body: object = {}): Promise<string> =>
    (await http().post('/api/conversations').send(body).expect(201)).body.id;
  const say = (id: string, content: string) =>
    readStream(http().post(`/api/conversations/${id}/messages`).send({ content }).expect(201));

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    resetFakeOpenAi();
    resetRateLimits();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('streams the reply, saves both messages and titles the conversation', async () => {
    await createMenuWorld(ctx);
    const id = await start();

    const { chunks } = await say(id, 'Hello there');

    expect(chunks.filter((chunk) => chunk.type === 'text-delta').map((c) => c.delta)).toEqual(
      FAKE_OPEN_AI_DELTAS,
    );
    expect(chunks.at(-1)).toMatchObject({ type: 'finish' });
    const { body } = await http().get(`/api/conversations/${id}`).expect(200);
    expect(body.title).toBe('Hello there');
    expect(body.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'Hello there' }),
      expect.objectContaining({ role: 'assistant', content: FAKE_OPEN_AI_DELTAS.join('') }),
    ]);
  });

  const textOf = (chunks: Array<{ type: string; delta?: string }>): string =>
    chunks
      .filter((chunk) => chunk.type === 'text-delta')
      .map((chunk) => chunk.delta)
      .join('');
  const savedMessages = async (id: string) =>
    (await http().get(`/api/conversations/${id}`).expect(200)).body.messages.map(
      ({ role, content }: { role: string; content: string }) => ({ role, content }),
    );

  it.each([[Intent.OutOfScope, OUT_OF_SCOPE_REPLY]])(
    'answers %s with a fixed reply, without the chat model',
    async (intent, reply) => {
      await createMenuWorld(ctx);
      const id = await start();
      fakeOpenAiState.intent = intent;

      const { chunks } = await say(id, 'Write me a poem');

      expect(textOf(chunks)).toBe(reply);
      expect(chunks.at(-1)).toMatchObject({ type: 'finish' });
      expect(fakeOpenAiState.streamTextCalls).toBe(0);
      expect(await savedMessages(id)).toEqual([
        { role: 'user', content: 'Write me a poem' },
        { role: 'assistant', content: reply },
      ]);
    },
  );

  it('streams the steps and the shape of the pending menu as transient parts before the menu, and saves none of them', async () => {
    await createMenuWorld(ctx);
    const id = await start();
    fakeOpenAiState.intent = Intent.GenerateMenu;
    fakeOpenAiState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });

    const { chunks } = await say(id, 'Plan my day');

    const progress = chunks.filter(
      (chunk) => chunk.type === 'data-status' || chunk.type === 'data-menu-pending',
    );
    expect(progress).toEqual([
      { type: 'data-status', data: { step: 'thinking', message: 'Thinking' }, transient: true },
      {
        type: 'data-status',
        data: { step: 'searching_breakfasts', message: 'Looking for breakfasts' },
        transient: true,
      },
      {
        type: 'data-menu-pending',
        data: {
          days: 1,
          mealTypes: [MealType.Breakfast, MealType.Lunch, MealType.Snack, MealType.Dinner],
        },
        transient: true,
      },
      {
        type: 'data-status',
        data: { step: 'picking_lunches', message: 'Picking lunches' },
        transient: true,
      },
      {
        type: 'data-status',
        data: { step: 'checking_constraints', message: 'Checking the constraints' },
        transient: true,
      },
    ]);
    const types = chunks.map((chunk) => chunk.type);
    expect(types.lastIndexOf('data-status')).toBeLessThan(types.indexOf('data-menu'));
    expect(await savedMessages(id)).toEqual([
      { role: 'user', content: 'Plan my day' },
      { role: 'assistant', content: 'Here is your day.' },
    ]);
  });

  it('plans a one-day menu with a snack from the model choice, servings fitted to the goal, and saves it with its message', async () => {
    const { recipe } = await createMenuWorld(ctx);
    const id = await start();
    fakeOpenAiState.intent = Intent.GenerateMenu;
    fakeOpenAiState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });

    const { chunks } = await say(id, 'Plan my day');

    expect(textOf(chunks)).toBe('Here is your day.');
    const menu = chunks.find((chunk) => chunk.type === 'data-menu')?.data.composition;
    expect(menu.days).toHaveLength(1);
    expect(
      menu.days[0].meals.map((meal: { recipeId: string; servings: number }) => [
        meal.recipeId,
        meal.servings,
      ]),
    ).toEqual([
      [recipe.oats, 1.25],
      [recipe.chicken, 1.25],
      [recipe.snack, 1.25],
      [recipe.bowl, 1.25],
    ]);
    expect(menu.days[0].totals.kcal).toBe(2162.5);
    expect(menu.issues).toEqual([]);
    expect(fakeOpenAiState.streamTextCalls).toBe(0);
    expect(await savedMessages(id)).toEqual([
      { role: 'user', content: 'Plan my day' },
      { role: 'assistant', content: 'Here is your day.' },
    ]);
    const { body } = await http().get(`/api/conversations/${id}`).expect(200);
    expect(body.messages[0].suggestedMenu).toBeNull();
    expect(body.messages[1].suggestedMenu).toEqual(menu);
    const { menuId, versionId } = chunks.find((chunk) => chunk.type === 'data-menu')?.data ?? {};
    expect(body).toMatchObject({ menuId });
    expect(body.messages[1]).toMatchObject({ menuId, menuVersionId: versionId });

    const saved = await http().get(`/api/menus/${menuId}`).expect(200);
    expect(saved.body).toMatchObject({ title: '1-day menu', confirmedVersionId: null });
    expect(saved.body.versions).toEqual([
      expect.objectContaining({
        id: versionId,
        versionNumber: 1,
        generatedBy: 'llm',
        isConfirmed: false,
        nutritionGoal: expect.objectContaining({ caloriesKcal: 2172 }),
        dailyAverage: menu.dailyAverage,
        issues: [],
      }),
    ]);
    expect(
      saved.body.versions[0].days[0].meals.map(
        (meal: { recipeId: string; servings: number; recipe: { name: string } }) => [
          meal.recipeId,
          meal.servings,
          meal.recipe.name,
        ],
      ),
    ).toEqual([
      [recipe.oats, 1.25, 'Oatmeal'],
      [recipe.chicken, 1.25, 'Chicken with rice'],
      [recipe.snack, 1.25, 'Oat snack'],
      [recipe.bowl, 1.25, 'Rice bowl'],
    ]);
  });

  it('saves two generations of a conversation as one draft menu with two versions, out of the menu list', async () => {
    await createMenuWorld(ctx);
    const id = await start();
    fakeOpenAiState.intent = Intent.GenerateMenu;
    fakeOpenAiState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });
    const menuOf = (chunks: Array<{ type: string; data?: any }>) =>
      chunks.find((chunk) => chunk.type === 'data-menu')?.data;

    const first = menuOf((await say(id, 'Plan my day')).chunks);
    fakeOpenAiState.intent = Intent.ReviseMenu;
    const second = menuOf((await say(id, 'Another one')).chunks);

    expect(second.menuId).toBe(first.menuId);
    expect(second.versionId).not.toBe(first.versionId);
    expect(await ctx.prisma.menu.count()).toBe(1);
    const { body } = await http().get(`/api/menus/${first.menuId}`).expect(200);
    expect(
      body.versions.map((v: { id: string; versionNumber: number }) => [v.id, v.versionNumber]),
    ).toEqual([
      [second.versionId, 2],
      [first.versionId, 1],
    ]);
    const conversation = (await http().get(`/api/conversations/${id}`).expect(200)).body;
    expect(conversation.menuId).toBe(first.menuId);
    expect(
      conversation.messages.map((m: { menuVersionId: string | null }) => m.menuVersionId),
    ).toEqual([null, first.versionId, null, second.versionId]);

    await http().get('/api/menus').expect(200, []);
    expect((await http().get('/api/menus?status=draft').expect(200)).body).toEqual([
      expect.objectContaining({ id: first.menuId, versionCount: 2, confirmedVersionId: null }),
    ]);

    await http()
      .post(`/api/menus/${first.menuId}/versions/${second.versionId}/confirm`)
      .expect(200);
    expect((await http().get('/api/menus').expect(200)).body).toEqual([
      expect.objectContaining({ id: first.menuId, confirmedVersionId: second.versionId }),
    ]);
    await http().get('/api/menus?status=draft').expect(200, []);
  });

  it('confirms the version of a reply, lists the menu, and switches to another confirmed version', async () => {
    await createMenuWorld(ctx);
    const id = await start();
    fakeOpenAiState.intent = Intent.GenerateMenu;
    fakeOpenAiState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });
    await say(id, 'Plan my day');
    await say(id, 'Plan it again');
    const replies = (await http().get(`/api/conversations/${id}`).expect(200)).body.messages.filter(
      (m: { role: string }) => m.role === 'assistant',
    );
    const [first, second] = replies.map((m: { menuId: string; menuVersionId: string }) => ({
      menuId: m.menuId,
      versionId: m.menuVersionId,
    }));
    const confirm = (version: { menuId: string; versionId: string }) =>
      http().post(`/api/menus/${version.menuId}/versions/${version.versionId}/confirm`).expect(200);
    const confirmedOf = (menu: { versions: Array<{ id: string; isConfirmed: boolean }> }) =>
      menu.versions.filter((v) => v.isConfirmed).map((v) => v.id);

    await http().get('/api/menus').expect(200, []);

    const confirmedFirst = (await confirm(first)).body;
    expect(confirmedFirst).toMatchObject({
      id: first.menuId,
      confirmedVersionId: first.versionId,
      confirmedAt: expect.any(String),
    });
    expect(confirmedOf(confirmedFirst)).toEqual([first.versionId]);
    expect((await http().get('/api/menus').expect(200)).body).toEqual([
      expect.objectContaining({ id: first.menuId, confirmedVersionId: first.versionId }),
    ]);

    const switched = (await confirm(second)).body;
    expect(switched.confirmedVersionId).toBe(second.versionId);
    expect(confirmedOf(switched)).toEqual([second.versionId]);
    expect((await http().get('/api/menus').expect(200)).body).toEqual([
      expect.objectContaining({ id: first.menuId, confirmedVersionId: second.versionId }),
    ]);
    await http().get('/api/menus?status=draft').expect(200, []);
  });

  it('keeps the confirmed version when another one breaks the preferences now', async () => {
    await createMenuWorld(ctx);
    const id = await start();
    fakeOpenAiState.intent = Intent.GenerateMenu;
    fakeOpenAiState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });
    const menuOf = async (content: string) =>
      (await say(id, content)).chunks.find((chunk) => chunk.type === 'data-menu')?.data;
    const first = await menuOf('Plan my day');
    const second = await menuOf('Plan it again');
    await http().post(`/api/menus/${first.menuId}/versions/${first.versionId}/confirm`).expect(200);
    await http()
      .post('/api/preferences')
      .send({ preferenceType: 'excluded_ingredient', value: 'chicken' })
      .expect(201);

    const { body } = await http()
      .post(`/api/menus/${second.menuId}/versions/${second.versionId}/confirm`)
      .expect(400);

    expect(body.message).toContain('The menu breaks the profile rules');
    const menu = (await http().get(`/api/menus/${first.menuId}`).expect(200)).body;
    expect(menu.confirmedVersionId).toBe(first.versionId);
  });

  it('starts a new draft menu when the menu of the conversation was deleted', async () => {
    await createMenuWorld(ctx);
    const id = await start();
    fakeOpenAiState.intent = Intent.GenerateMenu;
    fakeOpenAiState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });
    const first = (await say(id, 'Plan my day')).chunks.find((c) => c.type === 'data-menu')?.data;
    await http().delete(`/api/menus/${first.menuId}`).expect(204);

    const second = (await say(id, 'Plan again')).chunks.find((c) => c.type === 'data-menu')?.data;

    expect(second.menuId).not.toBe(first.menuId);
    const { body } = await http().get(`/api/conversations/${id}`).expect(200);
    expect(body.menuId).toBe(second.menuId);
  });

  it('plans every day of the request and composes them all', async () => {
    await createMenuWorld(ctx);
    const id = await start();
    fakeOpenAiState.intent = Intent.GenerateMenu;
    fakeOpenAiState.menuRequest = { ...menuRequest, days: 5 };
    fakeOpenAiState.menuPlan = fakeMenuPlan(
      'Here are your days.',
      { breakfast: 'Oatmeal', lunch: 'Chicken with rice', dinner: 'Rice bowl' },
      5,
    );

    const { chunks } = await say(id, 'Plan 5 days');

    const [, planned] = fakeOpenAiState.structuredInputs as Array<Array<{ content: string }>>;
    expect(JSON.parse(planned[0].content).days).toBe(5);
    const menu = chunks.find((chunk) => chunk.type === 'data-menu')?.data.composition;
    expect(menu.days.map(({ dayIndex }: { dayIndex: number }) => dayIndex)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(menu.dailyAverage.kcal).toBe(2162.5);
  });

  it('retries a plan with fewer days than requested and fails after the last attempt', async () => {
    await createMenuWorld(ctx);
    const id = await start();
    fakeOpenAiState.intent = Intent.GenerateMenu;
    fakeOpenAiState.menuRequest = { ...menuRequest, days: 3 };
    fakeOpenAiState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });

    const { chunks } = await say(id, 'Plan 3 days');

    expect(chunks.some((chunk) => chunk.type === 'data-menu')).toBe(false);
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'data-error',
        data: expect.objectContaining({ message: MENU_PLAN_FAILED_REPLY }),
      }),
    );
    expect(fakeOpenAiState.structuredInputs).toHaveLength(1 + MENU_PLAN_MAX_ATTEMPTS);
    const retry = fakeOpenAiState.structuredInputs.at(-1) as Array<{ content: string }>;
    expect(retry.at(-1)?.content).toContain('Return exactly 3 days');
  });

  it('classifies a follow-up with the history and plans the restated request', async () => {
    await createMenuWorld(ctx);
    const id = await start();
    await say(id, 'Plan my day');
    fakeOpenAiState.structuredInputs = [];
    fakeOpenAiState.intent = Intent.GenerateMenu;
    fakeOpenAiState.request = 'Plan a one-day menu.';
    fakeOpenAiState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });

    const { chunks } = await say(id, 'done do it again');

    expect(chunks.some((chunk) => chunk.type === 'data-menu')).toBe(true);
    const [classified, planned] = fakeOpenAiState.structuredInputs as Array<
      Array<{ role: string; content: string }>
    >;
    expect(JSON.parse(classified[0].content).profile).toMatchObject({ goal: 'maintain' });
    expect(classified.slice(1)).toEqual([
      { role: 'user', content: 'Plan my day' },
      { role: 'assistant', content: FAKE_OPEN_AI_DELTAS.join('') },
      { role: 'user', content: 'done do it again' },
    ]);
    expect(JSON.parse(planned[0].content).request).toBe('Plan a one-day menu.');
  });

  it('plans a revision of the menu again from the restated request', async () => {
    await createMenuWorld(ctx);
    const id = await start();
    await say(id, 'Plan my day');
    fakeOpenAiState.structuredInputs = [];
    fakeOpenAiState.intent = Intent.ReviseMenu;
    fakeOpenAiState.request = 'Plan a one-day menu with another lunch.';
    fakeOpenAiState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });

    const { chunks } = await say(id, 'replace the lunch');

    expect(chunks.some((chunk) => chunk.type === 'data-menu')).toBe(true);
    const [, planned] = fakeOpenAiState.structuredInputs as Array<Array<{ content: string }>>;
    expect(JSON.parse(planned[0].content).request).toBe('Plan a one-day menu with another lunch.');
    expect(await ctx.prisma.menu.count()).toBe(1);
  });

  it('revises the whole menu without chicken as the next version, keeping the earlier constraints', async () => {
    const { recipe } = await createMenuWorld(ctx);
    const stew = await addLentilStew(ctx);
    const id = await start();
    const menuOf = (chunks: Array<{ type: string; data?: any }>) =>
      chunks.find((chunk) => chunk.type === 'data-menu')?.data;
    const candidates = (): Record<string, Array<{ name: string }>> =>
      JSON.parse((fakeOpenAiState.structuredInputs.at(-1) as Array<{ content: string }>)[0].content)
        .recipes;
    const names = (meal: string): string[] => candidates()[meal].map(({ name }) => name);

    fakeOpenAiState.intent = Intent.GenerateMenu;
    fakeOpenAiState.request = 'Plan a one-day menu without peanuts.';
    fakeOpenAiState.menuRequest = {
      ...EMPTY_MENU_REQUEST,
      days: 1,
      mealTypes: [MealType.Breakfast, MealType.Lunch, MealType.Snack, MealType.Dinner],
      excludedIngredients: ['peanut'],
    };
    fakeOpenAiState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });
    const first = menuOf((await say(id, 'Plan my day, no peanuts')).chunks);
    expect(names('dinner')).not.toContain('Peanut satay');
    expect(names('lunch')).toContain('Chicken with rice');

    fakeOpenAiState.intent = Intent.ReviseMenu;
    fakeOpenAiState.request = 'Plan a one-day menu without chicken.';
    fakeOpenAiState.menuRequest = { ...EMPTY_MENU_REQUEST, excludedIngredients: ['chicken'] };
    fakeOpenAiState.menuPlan = fakeMenuPlan('Here is your day without chicken.', {
      breakfast: 'Oatmeal',
      lunch: 'Lentil stew',
      dinner: 'Rice bowl',
    });
    const second = menuOf((await say(id, 'Redo it without chicken')).chunks);

    expect(names('lunch')).toEqual(['Lentil stew']);
    expect(names('dinner')).not.toContain('Peanut satay');
    expect(second.menuId).toBe(first.menuId);
    expect(
      second.composition.days[0].meals.map((meal: { recipeId: string }) => meal.recipeId),
    ).toEqual([recipe.oats, stew, recipe.snack, recipe.bowl]);
    const { body } = await http().get(`/api/menus/${first.menuId}`).expect(200);
    expect(
      body.versions.map((v: { id: string; versionNumber: number }) => [v.id, v.versionNumber]),
    ).toEqual([
      [second.versionId, 2],
      [first.versionId, 1],
    ]);
    const conversation = await ctx.prisma.conversation.findUniqueOrThrow({ where: { id } });
    expect(conversation.menuRequest).toMatchObject({
      days: 1,
      excludedIngredients: ['peanut', 'chicken'],
    });
  });

  it('gives the planner the profile, marking a missing goal as not set, and finds no calorie issues', async () => {
    await createMenuWorld(ctx, { goal: false });
    await http()
      .post('/api/preferences')
      .send({ preferenceType: 'allergy', value: 'peanut' })
      .expect(201);
    const id = await start();
    fakeOpenAiState.intent = Intent.GenerateMenu;
    fakeOpenAiState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });

    const { chunks } = await say(id, 'Plan my day');

    const [, planned] = fakeOpenAiState.structuredInputs as Array<Array<{ content: string }>>;
    expect(JSON.parse(planned[0].content).profile).toEqual({
      goal: 'maintain',
      dailyTarget: 'not set',
      diets: [],
      allergies: ['peanut'],
      excludedIngredients: [],
      dislikedFoods: [],
    });
    const menu = chunks.find((chunk) => chunk.type === 'data-menu')?.data.composition;
    expect(menu.issues).toEqual([]);
  });

  it('gives the planner the calories and macros of a serving of each recipe, by short ids', async () => {
    await createMenuWorld(ctx);
    const id = await start();
    fakeOpenAiState.intent = Intent.GenerateMenu;
    fakeOpenAiState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });

    await say(id, 'Plan my day');

    const [, planned] = fakeOpenAiState.structuredInputs as Array<Array<{ content: string }>>;
    const { profile, recipes } = JSON.parse(planned[0].content);
    expect(profile.dailyTarget).toMatchObject({ kcal: 2172 });
    expect(recipes.breakfast).toEqual([
      {
        id: 'b1',
        name: 'Oatmeal',
        perServing: { kcal: 444, proteinG: 16, fatG: 8, carbsG: 72 },
        complete: true,
      },
    ]);
  });

  it('reports a recipe outside the allowed ones as a failed menu after every attempt', async () => {
    await createMenuWorld(ctx);
    await http()
      .post('/api/preferences')
      .send({ preferenceType: 'allergy', value: 'peanut' })
      .expect(201);
    const id = await start();
    fakeOpenAiState.intent = Intent.GenerateMenu;
    fakeOpenAiState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Peanut satay',
    });

    const { chunks } = await say(id, 'Plan my day');

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'data-error',
        data: expect.objectContaining({
          code: ChatErrorCode.AssistantInvalidOutput,
          message: MENU_PLAN_FAILED_REPLY,
        }),
      }),
    );
    // The classification, then every attempt of the planner.
    expect(fakeOpenAiState.structuredInputs).toHaveLength(1 + MENU_PLAN_MAX_ATTEMPTS);
    expect(await savedMessages(id)).toEqual([{ role: 'user', content: 'Plan my day' }]);
  });

  it('answers without the model when a meal has no allowed recipe', async () => {
    await createMenuWorld(ctx);
    await http()
      .post('/api/preferences')
      .send({ preferenceType: 'diet', value: 'vegan' })
      .expect(201);
    const id = await start();
    fakeOpenAiState.intent = Intent.GenerateMenu;

    const { chunks } = await say(id, 'Plan my day');

    expect(textOf(chunks)).toBe(NO_MENU_RECIPES_REPLY);
    expect(chunks.some((chunk) => chunk.type === 'data-menu')).toBe(false);
  });

  it('plans vegan recipes for a vegetarian', async () => {
    const { recipe } = await createMenuWorld(ctx);
    const rice = await ctx.prisma.foodItem.findFirstOrThrow({ where: { name: 'Rice, boiled' } });
    const lunch = (
      await http()
        .post('/api/recipes')
        .send({
          name: 'Rice lunch',
          instructions: 'Cook.',
          mealType: 'lunch',
          dietType: ['vegan'],
          servings: 1,
          ingredients: [{ foodItemId: rice.id, quantityG: 300 }],
        })
        .expect(201)
    ).body.id as string;
    await http()
      .post('/api/preferences')
      .send({ preferenceType: 'diet', value: 'vegetarian' })
      .expect(201);
    const id = await start();
    fakeOpenAiState.intent = Intent.GenerateMenu;
    fakeOpenAiState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Rice lunch',
      dinner: 'Rice bowl',
    });

    const { chunks } = await say(id, 'Plan my day');

    const menu = chunks.find((chunk) => chunk.type === 'data-menu')?.data.composition;
    expect(menu.days[0].meals.map((meal: { recipeId: string }) => meal.recipeId)).toEqual([
      recipe.oats,
      lunch,
      recipe.snack,
      recipe.bowl,
    ]);
  });

  it('asks for the missing details instead of generating a menu', async () => {
    await createMenuWorld(ctx);
    const id = await start();
    fakeOpenAiState.intent = Intent.Clarification;

    const { chunks } = await say(id, 'Make a menu');

    expect(textOf(chunks)).toBe(CLARIFICATION_REPLY);
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'data-clarification',
        data: { missingFields: ['days', 'mealTypes'] },
      }),
    );
    expect(fakeOpenAiState.streamTextCalls).toBe(0);
    expect(await ctx.prisma.menu.count()).toBe(0);
  });

  const storedMenuRequest = async (id: string): Promise<unknown> =>
    (await ctx.prisma.conversation.findUniqueOrThrow({ where: { id } })).menuRequest;
  const menuRequest = {
    days: null,
    mealTypes: [],
    caloriesKcal: null,
    diets: [],
    excludedIngredients: [],
    dislikedFoods: [],
  };

  it('keeps the answer to a clarification in the conversation for later requests', async () => {
    await createMenuWorld(ctx);
    await addLentilStew(ctx);
    const id = await start();
    fakeOpenAiState.intent = Intent.Clarification;
    await say(id, 'Make a menu');
    expect(await storedMenuRequest(id)).toBeNull();

    fakeOpenAiState.intent = Intent.GenerateMenu;
    fakeOpenAiState.menuRequest = {
      ...menuRequest,
      days: 3,
      mealTypes: [MealType.Breakfast, MealType.Dinner],
      excludedIngredients: ['mushrooms'],
    };
    fakeOpenAiState.menuPlan = fakeMenuPlan(
      'Here are your days.',
      { breakfast: 'Oatmeal', lunch: 'Chicken with rice', dinner: 'Rice bowl' },
      3,
    );
    await say(id, '3 days, breakfast and dinner, no mushrooms');
    expect(await storedMenuRequest(id)).toEqual(fakeOpenAiState.menuRequest);

    fakeOpenAiState.menuRequest = { ...menuRequest, diets: [DietTag.Vegetarian] };
    fakeOpenAiState.menuPlan = fakeMenuPlan(
      'Here are your days.',
      { breakfast: 'Oatmeal', lunch: 'Lentil stew', dinner: 'Rice bowl' },
      3,
    );
    await say(id, 'regenerate it vegetarian');
    expect(await storedMenuRequest(id)).toEqual({
      ...menuRequest,
      days: 3,
      mealTypes: [MealType.Breakfast, MealType.Dinner],
      diets: [DietTag.Vegetarian],
      excludedIngredients: ['mushrooms'],
    });

    fakeOpenAiState.intent = Intent.Clarification;
    fakeOpenAiState.menuRequest = null;
    fakeOpenAiState.structuredInputs = [];
    const { chunks } = await say(id, 'and another one');
    expect(chunks.some((chunk) => chunk.type === 'data-clarification')).toBe(false);
    expect(chunks.some((chunk) => chunk.type === 'data-menu')).toBe(true);
    const [, planned] = fakeOpenAiState.structuredInputs as Array<Array<{ content: string }>>;
    expect(JSON.parse(planned[0].content).request).toBe(
      'Plan a 3-day menu with breakfast, dinner that is vegetarian without mushrooms.',
    );
  });

  it.each([
    [10, 7, 'I can plan a menu for up to 7 days, not 10. Shall I make a 7-day menu?'],
    [0, 1, 'A menu needs at least 1 day. Shall I make a 1-day menu?'],
    [-3, 1, 'A menu needs at least 1 day. Shall I make a 1-day menu?'],
  ])(
    'answers a menu for %i days with an offer of %i instead of cutting it silently',
    async (requested, offered, reply) => {
      await createMenuWorld(ctx);
      const id = await start();
      fakeOpenAiState.intent = Intent.GenerateMenu;
      fakeOpenAiState.menuRequest = { ...menuRequest, days: requested };

      const { chunks } = await say(id, `A menu for ${requested} days`);

      expect(textOf(chunks)).toBe(reply);
      expect(chunks).toContainEqual(
        expect.objectContaining({ type: 'data-clarification', data: { missingFields: ['days'] } }),
      );
      expect(chunks.some((chunk) => chunk.type === 'data-menu')).toBe(false);
      expect(await savedMessages(id)).toEqual([
        { role: 'user', content: `A menu for ${requested} days` },
        { role: 'assistant', content: reply },
      ]);
      expect(await storedMenuRequest(id)).toEqual({ ...menuRequest, days: offered });
    },
  );

  it('reports a failed classification as an error and saves no reply', async () => {
    await createMenuWorld(ctx);
    const id = await start();
    fakeOpenAiState.intent = 'unavailable';

    const { status, chunks } = await say(id, 'Hi');

    expect(status).toBe(201);
    expect(chunks.slice(-2)).toEqual([
      expect.objectContaining({
        type: 'data-error',
        data: {
          code: 'assistant_unavailable',
          message: ASSISTANT_UNAVAILABLE_REPLY,
          retryable: true,
        },
      }),
      { type: 'error', errorText: ASSISTANT_UNAVAILABLE_REPLY },
    ]);
    expect(fakeOpenAiState.streamTextCalls).toBe(0);
    expect(await savedMessages(id)).toEqual([{ role: 'user', content: 'Hi' }]);
  });

  it('reports invalid model output with its own error and saves no reply', async () => {
    await createMenuWorld(ctx);
    const id = await start();
    fakeOpenAiState.intent = 'invalid';

    const { chunks } = await say(id, 'Hi');

    expect(chunks.slice(-2)).toEqual([
      expect.objectContaining({
        type: 'data-error',
        data: {
          code: 'assistant_invalid_output',
          message: ASSISTANT_INVALID_OUTPUT_REPLY,
          retryable: true,
        },
      }),
      { type: 'error', errorText: ASSISTANT_INVALID_OUTPUT_REPLY },
    ]);
    expect(await savedMessages(id)).toEqual([{ role: 'user', content: 'Hi' }]);
  });

  it('lists, renames, links and deletes conversations', async () => {
    const world = await createMenuWorld(ctx);
    const older = await start({ title: 'Older' });
    const newer = await start({ title: 'Newer' });
    await say(older, 'hi');

    const list = await http().get('/api/conversations').expect(200);
    expect(list.body.map((c: { title: string }) => c.title)).toEqual(['Older', 'Newer']);
    expect(list.body[0].messageCount).toBe(2);

    const menuId = await seedMenu(ctx, 'Week', [
      { dayIndex: 0, meals: [{ mealType: 'lunch', recipeId: world.recipe.chicken, servings: 1 }] },
    ]);
    const linked = await http()
      .patch(`/api/conversations/${newer}`)
      .send({ title: 'About the menu', menuId })
      .expect(200);
    expect(linked.body).toMatchObject({ title: 'About the menu', menuId });

    await http().delete(`/api/menus/${menuId}`).expect(204);
    const unlinked = await http().get(`/api/conversations/${newer}`).expect(200);
    expect(unlinked.body.menuId).toBeNull();

    await http().delete(`/api/conversations/${older}`).expect(204);
    await http().get(`/api/conversations/${older}`).expect(404);
    expect(await ctx.prisma.message.count()).toBe(0);
  });

  it('validates input and ownership', async () => {
    await createMenuWorld(ctx);
    const id = await start();

    await http().post(`/api/conversations/${id}/messages`).send({ content: '  ' }).expect(400);
    await http()
      .post(`/api/conversations/${id}/messages`)
      .send({ content: 'x'.repeat(301) })
      .expect(400);
    await http()
      .post('/api/conversations')
      .send({ menuId: '2b1e7f3a-5d47-4a8e-9f6c-1d2e3f4a5b6c' })
      .expect(404);
    await http()
      .post('/api/conversations/2b1e7f3a-5d47-4a8e-9f6c-1d2e3f4a5b6c/messages')
      .send({ content: 'hi' })
      .expect(404);
  });

  it('needs a profile', async () => {
    await http().get('/api/conversations').expect(404);
  });
});
