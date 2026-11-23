import { addLentilStew, addRiceRecipes, createMenuWorld, seedMenu } from './menu-fixtures';
import { readStream } from './menu-stream';
import { EMPTY_MENU_REQUEST } from '../src/modules/services/menu/menu-request';
import {
  ASSISTANT_INVALID_OUTPUT_REPLY,
  ASSISTANT_UNAVAILABLE_REPLY,
  ChatErrorCode,
  CLARIFICATION_REPLY,
  CONVERSATION_LIMIT_REPLY,
  CONVERSATION_MAX_USER_MESSAGES,
  MESSAGE_MAX_LENGTH,
  MessageRole,
  MODEL_HISTORY_MAX_TOKENS,
  DietTag,
  Intent,
  MealType,
  MENU_PLAN_FAILED_REPLY,
  MENU_PLAN_MAX_ATTEMPTS,
  MENU_DAY_PROMPT,
  MENU_MEAL_PROMPT,
  menuTargetDayReply,
  MENU_PLAN_MEAL_TYPES,
  MENU_PLAN_PROMPT,
  MenuTargetScope,
  OUT_OF_SCOPE_REPLY,
  MENU_SAVE_QUESTION,
} from '../src/common/constants';
import { MenuTarget } from '../src/common/contracts';
import { estimateTokens } from '../src/common/utils';
import {
  createTestApp,
  FAKE_MODEL_ID,
  FAKE_OPEN_AI_DELTAS,
  FAKE_SUMMARY,
  FakeMenuPlan,
  fakeMenuPlan,
  fakeLlmState,
  resetDatabase,
  resetFakeLlm,
  resetRateLimits,
  TestApp,
} from './test-app';

describe('/api/conversations (e2e)', () => {
  let ctx: TestApp;
  const http = () => ctx.http();
  const start = async (body: object = {}): Promise<string> =>
    (await http().post('/api/conversations').send(body).expect(201)).body.id;
  const say = (id: string, content: string) =>
    readStream(http().post(`/api/conversations/${id}/messages`).send({ content }).expect(201));

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    resetFakeLlm();
    await resetRateLimits();
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
      fakeLlmState.intent = intent;

      const { chunks } = await say(id, 'Write me a poem');

      expect(textOf(chunks)).toBe(reply);
      expect(chunks.at(-1)).toMatchObject({ type: 'finish' });
      expect(fakeLlmState.streamTextCalls).toBe(0);
      expect(await savedMessages(id)).toEqual([
        { role: 'user', content: 'Write me a poem' },
        { role: 'assistant', content: reply },
      ]);
    },
  );

  it('streams the steps and the shape of the pending menu as transient parts before the menu, and saves none of them', async () => {
    await createMenuWorld(ctx);
    const id = await start();
    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.menuPlan = fakeMenuPlan('Here is your day.', {
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
      { role: 'assistant', content: `Here is your day.\n\n${MENU_SAVE_QUESTION}` },
    ]);
  });

  it('plans a one-day menu with a snack from the model choice, servings fitted to the goal, and saves it with its message', async () => {
    const { recipe } = await createMenuWorld(ctx);
    const id = await start();
    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });

    const { chunks } = await say(id, 'Plan my day');

    expect(textOf(chunks)).toBe(`Here is your day.${MENU_SAVE_QUESTION}`);
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
    expect(fakeLlmState.streamTextCalls).toBe(0);
    expect(await savedMessages(id)).toEqual([
      { role: 'user', content: 'Plan my day' },
      { role: 'assistant', content: `Here is your day.\n\n${MENU_SAVE_QUESTION}` },
    ]);
    const { body } = await http().get(`/api/conversations/${id}`).expect(200);
    const { menuId, versionId } = chunks.find((chunk) => chunk.type === 'data-menu')?.data ?? {};
    expect(body).toMatchObject({ menuId });
    expect(body.messages[0]).toMatchObject({ menuId: null, menuVersionId: null });
    expect(body.messages[1]).toMatchObject({ menuId, menuVersionId: versionId });
    expect(body.messages[1]).not.toHaveProperty('suggestedMenu');

    const saved = await http().get(`/api/menus/${menuId}`).expect(200);
    expect(saved.body).toMatchObject({ title: '1-day menu', confirmedVersionId: null });
    expect(saved.body.versions).toEqual([
      expect.objectContaining({
        id: versionId,
        versionNumber: 1,
        generatedBy: 'llm',
        notes: `model: ${FAKE_MODEL_ID}; prompt: menu-plan@v${MENU_PLAN_PROMPT.version}`,
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
    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });
    const menuOf = (chunks: Array<{ type: string; data?: any }>) =>
      chunks.find((chunk) => chunk.type === 'data-menu')?.data;

    const first = menuOf((await say(id, 'Plan my day')).chunks);
    fakeLlmState.intent = Intent.ReviseMenu;
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
    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.menuPlan = fakeMenuPlan('Here is your day.', {
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
    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.menuPlan = fakeMenuPlan('Here is your day.', {
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
    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.menuPlan = fakeMenuPlan('Here is your day.', {
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
    await addRiceRecipes(ctx, 2);
    const id = await start();
    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.menuRequest = { ...menuRequest, days: 5 };
    fakeLlmState.menuPlan = fakeMenuPlan(
      'Here are your days.',
      { breakfast: 'Oatmeal', lunch: 'Chicken with rice', dinner: 'Rice bowl' },
      5,
    );

    const { chunks } = await say(id, 'Plan 5 days');

    const [, planned] = fakeLlmState.structuredInputs as Array<Array<{ content: string }>>;
    expect(JSON.parse(planned[0].content).days).toBe(5);
    const menu = chunks.find((chunk) => chunk.type === 'data-menu')?.data.composition;
    expect(menu.days.map(({ dayIndex }: { dayIndex: number }) => dayIndex)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(menu.dailyAverage.kcal).toBe(2162.5);
  });

  it('retries a plan with fewer days than requested and fails after the last attempt', async () => {
    await createMenuWorld(ctx);
    await addRiceRecipes(ctx, 1);
    const id = await start();
    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.menuRequest = { ...menuRequest, days: 3 };
    fakeLlmState.menuPlan = fakeMenuPlan('Here is your day.', {
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
    expect(fakeLlmState.structuredInputs).toHaveLength(1 + MENU_PLAN_MAX_ATTEMPTS);
    const retry = fakeLlmState.structuredInputs.at(-1) as Array<{ content: string }>;
    expect(retry.at(-1)?.content).toContain('Return exactly 3 days');
  });

  it('classifies a follow-up with the history and plans the restated request', async () => {
    await createMenuWorld(ctx);
    const id = await start();
    await say(id, 'Plan my day');
    fakeLlmState.structuredInputs = [];
    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.request = 'Plan a one-day menu.';
    fakeLlmState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });

    const { chunks } = await say(id, 'done do it again');

    expect(chunks.some((chunk) => chunk.type === 'data-menu')).toBe(true);
    const [classified, planned] = fakeLlmState.structuredInputs as Array<
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
    fakeLlmState.structuredInputs = [];
    fakeLlmState.intent = Intent.ReviseMenu;
    fakeLlmState.request = 'Plan a one-day menu with another lunch.';
    fakeLlmState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });

    const { chunks } = await say(id, 'replace the lunch');

    expect(chunks.some((chunk) => chunk.type === 'data-menu')).toBe(true);
    const [, planned] = fakeLlmState.structuredInputs as Array<Array<{ content: string }>>;
    expect(JSON.parse(planned[0].content).request).toBe('Plan a one-day menu with another lunch.');
    expect(await ctx.prisma.menu.count()).toBe(1);
  });

  it('redoes one day of the suggested menu, copying the other days and leaving their recipes out', async () => {
    const { recipe } = await createMenuWorld(ctx);
    await addRiceRecipes(ctx, 2);
    const id = await start();
    const threeDays = {
      ...EMPTY_MENU_REQUEST,
      days: 3,
      mealTypes: [MealType.Breakfast, MealType.Lunch, MealType.Snack, MealType.Dinner],
    };
    const menuOf = (chunks: Array<{ type: string; data?: any }>) =>
      chunks.find((chunk) => chunk.type === 'data-menu')?.data;
    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.menuRequest = threeDays;
    fakeLlmState.menuPlan = fakeMenuPlan(
      'Here are your days.',
      { breakfast: 'Oatmeal', lunch: 'Chicken with rice', dinner: 'Rice bowl' },
      3,
    );
    const first = menuOf((await say(id, 'Plan 3 days')).chunks);

    fakeLlmState.structuredInputs = [];
    fakeLlmState.intent = Intent.ReviseMenu;
    fakeLlmState.request = 'Plan a 3-day menu with day 2 planned again.';
    fakeLlmState.menuRequest = { ...EMPTY_MENU_REQUEST };
    fakeLlmState.targets = [{ scope: MenuTargetScope.Day, dayIndex: 1, mealType: null }];
    fakeLlmState.menuPlan = fakeMenuPlan('Here is a new Tuesday.', {
      breakfast: 'Rice breakfast 1',
      lunch: 'Rice lunch 1',
      snack: 'Rice snack 1',
      dinner: 'Rice dinner 1',
    });
    const second = menuOf((await say(id, 'Redo Tuesday')).chunks);

    const [, planned] = fakeLlmState.structuredInputs as Array<Array<{ content: string }>>;
    const sent = JSON.parse(planned[0].content);
    expect(sent).toMatchObject({
      dayIndex: 1,
      request: 'Plan a 3-day menu with day 2 planned again.',
    });
    expect(sent.days).toBeUndefined();
    const offered = Object.values(sent.recipes as Record<string, Array<{ name: string }>>)
      .flat()
      .map(({ name }) => name);
    expect(offered).not.toContain('Oatmeal');
    expect(offered).not.toContain('Chicken with rice');
    expect(offered).not.toContain('Rice bowl');
    expect(second.menuId).toBe(first.menuId);

    const versions = await ctx.prisma.menuVersion.findMany({
      where: { menuId: first.menuId },
      orderBy: { versionNumber: 'asc' },
      include: {
        days: {
          orderBy: { dayIndex: 'asc' },
          include: { meals: { orderBy: { position: 'asc' } } },
        },
      },
    });
    const daysOf = (version: (typeof versions)[number]) =>
      version.days.map(({ dayIndex, date, meals }) => ({
        dayIndex,
        date,
        meals: meals.map(({ mealType, position, recipeId, servings, recipeSnapshot }) => ({
          mealType,
          position,
          recipeId,
          servings: servings.toString(),
          recipeSnapshot,
        })),
      }));
    const [before, after] = versions.map(daysOf);
    expect(JSON.stringify(after[0])).toBe(JSON.stringify(before[0]));
    expect(JSON.stringify(after[2])).toBe(JSON.stringify(before[2]));
    expect(after[1].meals.map(({ recipeId }) => recipeId)).not.toContain(recipe.oats);
    expect(after[1].meals.map(({ recipeId }) => recipeId)).toHaveLength(4);
    expect(
      second.composition.days.map((day: { meals: Array<{ recipeName: string }> }) =>
        day.meals.map(({ recipeName }) => recipeName),
      ),
    ).toEqual([
      ['Oatmeal', 'Chicken with rice', 'Oat snack', 'Rice bowl'],
      ['Rice breakfast 1', 'Rice lunch 1', 'Rice snack 1', 'Rice dinner 1'],
      ['Oatmeal', 'Chicken with rice', 'Oat snack', 'Rice bowl'],
    ]);
    expect(versions[1].notes).toBe(
      `model: ${FAKE_MODEL_ID}; prompt: menu-day@v${MENU_DAY_PROMPT.version}`,
    );
  });

  describe('replacing one meal', () => {
    const threeDays = {
      ...EMPTY_MENU_REQUEST,
      days: 3,
      mealTypes: [MealType.Breakfast, MealType.Lunch, MealType.Snack, MealType.Dinner],
    };
    const menuOf = (chunks: Array<{ type: string; data?: any }>) =>
      chunks.find((chunk) => chunk.type === 'data-menu')?.data;
    const versionsOf = (menuId: string) =>
      ctx.prisma.menuVersion.findMany({
        where: { menuId },
        orderBy: { versionNumber: 'asc' },
        include: {
          days: {
            orderBy: { dayIndex: 'asc' },
            include: { meals: { orderBy: { position: 'asc' } } },
          },
        },
      });
    /** A conversation with a suggested 3-day menu, then a revision of the target. */
    const planThenRevise = async (target: MenuTarget) => {
      await createMenuWorld(ctx);
      await addRiceRecipes(ctx, 2);
      const id = await start();
      fakeLlmState.intent = Intent.GenerateMenu;
      fakeLlmState.menuRequest = threeDays;
      fakeLlmState.menuPlan = fakeMenuPlan(
        'Here are your days.',
        { breakfast: 'Oatmeal', lunch: 'Chicken with rice', dinner: 'Rice bowl' },
        3,
      );
      const first = menuOf((await say(id, 'Plan 3 days')).chunks);
      fakeLlmState.structuredInputs = [];
      fakeLlmState.intent = Intent.ReviseMenu;
      fakeLlmState.request = 'Plan a 3-day menu with another dinner on day 3.';
      fakeLlmState.menuRequest = { ...EMPTY_MENU_REQUEST };
      fakeLlmState.targets = [target];
      fakeLlmState.menuPlan = fakeMenuPlan('Here is a new dinner.', {
        breakfast: 'none',
        lunch: 'none',
        dinner: 'Rice dinner 2',
      });
      return { first, second: await say(id, 'Another dinner on Wednesday') };
    };

    it('replaces only the meal, copying every other meal and leaving the recipes of the menu out', async () => {
      const { first, second } = await planThenRevise({
        scope: MenuTargetScope.Meal,
        dayIndex: 2,
        mealType: MealType.Dinner,
      });

      const [, planned] = fakeLlmState.structuredInputs as Array<Array<{ content: string }>>;
      const sent = JSON.parse(planned[0].content);
      expect(sent).toMatchObject({ dayIndex: 2, mealType: MealType.Dinner });
      const offered = (sent.recipes as Array<{ name: string }>).map(({ name }) => name);
      expect(offered).toEqual(expect.arrayContaining(['Rice dinner 1', 'Rice dinner 2']));
      expect(offered).not.toContain('Rice bowl');
      expect(menuOf(second.chunks).menuId).toBe(first.menuId);

      const versions = await versionsOf(first.menuId);
      const mealsOf = (version: (typeof versions)[number]) =>
        version.days.flatMap(({ meals }) =>
          meals.map(({ mealType, position, recipeId, servings, recipeSnapshot }) =>
            JSON.stringify({ mealType, position, recipeId, servings, recipeSnapshot }),
          ),
        );
      const [before, after] = versions.map(mealsOf);
      const changed = after.filter((meal, i) => meal !== before[i]);
      expect(changed).toHaveLength(1);
      expect(versions[1].days[2].meals[3].recipeSnapshot).toMatchObject({
        name: 'Rice dinner 2',
      });
      expect(versions[1].notes).toBe(
        `model: ${FAKE_MODEL_ID}; prompt: menu-meal@v${MENU_MEAL_PROMPT.version}`,
      );
    });

    it('asks which day when a meal of a menu of more days names none, without a new version', async () => {
      const { first, second } = await planThenRevise({
        scope: MenuTargetScope.Meal,
        dayIndex: null,
        mealType: MealType.Dinner,
      });

      expect(textOf(second.chunks)).toBe(menuTargetDayReply(MealType.Dinner, 3));
      expect(second.chunks).toContainEqual(
        expect.objectContaining({
          type: 'data-clarification',
          data: { missingFields: ['dayIndex'] },
        }),
      );
      expect(fakeLlmState.structuredInputs).toHaveLength(1);
      expect(await versionsOf(first.menuId)).toHaveLength(1);
    });
  });

  describe('replacing several days and meals', () => {
    const threeDays = {
      ...EMPTY_MENU_REQUEST,
      days: 3,
      mealTypes: [MealType.Breakfast, MealType.Lunch, MealType.Snack, MealType.Dinner],
    };
    const menuOf = (chunks: Array<{ type: string; data?: any }>) =>
      chunks.find((chunk) => chunk.type === 'data-menu')?.data;
    /** Every meal of the version by the name of its recipe, day by day. */
    const versionMeals = async (menuId: string) =>
      (
        await ctx.prisma.menuVersion.findMany({
          where: { menuId },
          orderBy: { versionNumber: 'asc' },
          include: {
            days: {
              orderBy: { dayIndex: 'asc' },
              include: { meals: { orderBy: { position: 'asc' } } },
            },
          },
        })
      ).map(({ notes, days }) => ({
        notes,
        days: days.map(({ meals }) =>
          meals.map(({ mealType, position, recipeId, servings, recipeSnapshot }) =>
            JSON.stringify({ mealType, position, recipeId, servings, recipeSnapshot }),
          ),
        ),
        names: days.map(({ meals }) =>
          meals.map(({ recipeSnapshot }) => (recipeSnapshot as { name: string }).name),
        ),
      }));
    /** The first rice recipe of every meal the planner offers. */
    const firstRice: FakeMenuPlan = (recipes) => ({
      message: 'Here is something new.',
      days: [
        {
          dayIndex: 0,
          meals: Object.fromEntries(
            MENU_PLAN_MEAL_TYPES.map((mealType) => [
              mealType,
              recipes[mealType].find(({ name }) => name.startsWith(`Rice ${mealType}`))?.id ??
                'none',
            ]),
          ) as ReturnType<FakeMenuPlan>['days'][number]['meals'],
        },
      ],
    });
    /** A conversation with a suggested 3-day menu, then a revision of the targets. */
    const planThenRevise = async (
      targets: MenuTarget[],
      plan: FakeMenuPlan = firstRice,
      revisionRequest = { ...EMPTY_MENU_REQUEST },
    ) => {
      await createMenuWorld(ctx);
      await addRiceRecipes(ctx, 2);
      const id = await start();
      fakeLlmState.intent = Intent.GenerateMenu;
      fakeLlmState.menuRequest = threeDays;
      fakeLlmState.menuPlan = fakeMenuPlan(
        'Here are your days.',
        { breakfast: 'Oatmeal', lunch: 'Chicken with rice', dinner: 'Rice bowl' },
        3,
      );
      const first = menuOf((await say(id, 'Plan 3 days')).chunks);
      fakeLlmState.structuredInputs = [];
      fakeLlmState.intent = Intent.ReviseMenu;
      fakeLlmState.request = 'Plan a 3-day menu with some parts planned again.';
      fakeLlmState.menuRequest = revisionRequest;
      fakeLlmState.targets = targets;
      fakeLlmState.menuPlan = plan;
      const second = await say(id, 'Change some parts');
      return { id, first, second, versions: await versionMeals(first.menuId) };
    };
    const day = (dayIndex: number): MenuTarget => ({
      scope: MenuTargetScope.Day,
      dayIndex,
      mealType: null,
    });
    const meal = (dayIndex: number, mealType: MealType): MenuTarget => ({
      scope: MenuTargetScope.Meal,
      dayIndex,
      mealType,
    });

    it('redoes a day and a meal of another day in one new version, repeating no recipe', async () => {
      const { first, second, versions } = await planThenRevise([day(0), meal(2, MealType.Dinner)]);

      expect(menuOf(second.chunks).menuId).toBe(first.menuId);
      expect(versions).toHaveLength(2);
      const [before, after] = versions;
      expect(after.days[1]).toEqual(before.days[1]);
      expect(after.days[2].slice(0, 3)).toEqual(before.days[2].slice(0, 3));
      expect(after.names[0]).toEqual([
        'Rice breakfast 1',
        'Rice lunch 1',
        'Rice snack 1',
        'Rice dinner 1',
      ]);
      expect(after.names[2][3]).toBe('Rice dinner 2');
      expect(after.notes).toBe(
        `model: ${FAKE_MODEL_ID}; prompt: menu-day@v${MENU_DAY_PROMPT.version}, menu-meal@v${MENU_MEAL_PROMPT.version}`,
      );
      expect(textOf(second.chunks)).toBe(
        `Here is something new. Here is something new.${MENU_SAVE_QUESTION}`,
      );
    });

    it('redoes every meal of a day as the whole day', async () => {
      const { versions } = await planThenRevise(
        MENU_PLAN_MEAL_TYPES.map((mealType) => meal(1, mealType)),
      );

      // The classifier, then one call for the day.
      expect(fakeLlmState.structuredInputs).toHaveLength(2);
      const [before, after] = versions;
      expect(after.days[0]).toEqual(before.days[0]);
      expect(after.days[2]).toEqual(before.days[2]);
      expect(after.notes).toBe(
        `model: ${FAKE_MODEL_ID}; prompt: menu-day@v${MENU_DAY_PROMPT.version}`,
      );
    });

    it('replaces the meals of the other days that break a constraint the request adds', async () => {
      const { versions } = await planThenRevise([day(0)], firstRice, {
        ...EMPTY_MENU_REQUEST,
        excludedIngredients: ['chicken'],
      });

      const [before, after] = versions;
      expect(before.names.map((meals) => meals[1])).toEqual([
        'Chicken with rice',
        'Chicken with rice',
        'Chicken with rice',
      ]);
      expect(after.names.flat().some((name) => name.includes('Chicken'))).toBe(false);
      // Day 1 whole, then the lunch of days 2 and 3 only.
      [1, 2].forEach((dayIndex) => {
        expect(after.days[dayIndex].filter((_, i) => i !== 1)).toEqual(
          before.days[dayIndex].filter((_, i) => i !== 1),
        );
      });
      expect(after.notes).toBe(
        `model: ${FAKE_MODEL_ID}; prompt: menu-day@v${MENU_DAY_PROMPT.version}, menu-meal@v${MENU_MEAL_PROMPT.version}`,
      );
    });

    it('leaves out the recipes the earlier versions dropped', async () => {
      const { id, first } = await planThenRevise([meal(2, MealType.Dinner)]);
      await say(id, 'Another dinner on Wednesday');
      fakeLlmState.structuredInputs = [];
      fakeLlmState.menuPlan = (recipes) => ({
        message: 'Here is something new.',
        days: [
          {
            dayIndex: 0,
            meals: Object.fromEntries(
              MENU_PLAN_MEAL_TYPES.map((mealType) => [mealType, recipes[mealType][0]?.id]),
            ) as ReturnType<FakeMenuPlan>['days'][number]['meals'],
          },
        ],
      });
      await say(id, 'And another one');

      const sent = (fakeLlmState.structuredInputs[1] as Array<{ content: string }>)[0].content;
      const names = JSON.parse(sent).recipes.map(({ name }: { name: string }) => name);
      // Rice dinner 1 of version 2, dropped by version 3, and Rice dinner 2 now in its place.
      expect(names).not.toContain('Rice dinner 1');
      expect(names).not.toContain('Rice dinner 2');
      expect(names.length).toBeGreaterThan(0);
      const versions = await versionMeals(first.menuId);
      expect(versions.map(({ names: days }) => days[2][3])).toEqual([
        'Rice bowl',
        'Rice dinner 1',
        'Rice dinner 2',
        names[0],
      ]);
    });

    it('plans the whole menu again when every day is named', async () => {
      const { versions } = await planThenRevise(
        [day(0), day(1), day(2)],
        fakeMenuPlan(
          'Here are new days.',
          { breakfast: 'Oatmeal', lunch: 'Chicken with rice', dinner: 'Rice bowl' },
          3,
        ),
      );

      expect(versions).toHaveLength(2);
      expect(versions[1].notes).toBe(
        `model: ${FAKE_MODEL_ID}; prompt: menu-plan@v${MENU_PLAN_PROMPT.version}`,
      );
    });
  });

  it('revises the whole menu without chicken as the next version, keeping the earlier constraints', async () => {
    const { recipe } = await createMenuWorld(ctx);
    const stew = await addLentilStew(ctx);
    const id = await start();
    const menuOf = (chunks: Array<{ type: string; data?: any }>) =>
      chunks.find((chunk) => chunk.type === 'data-menu')?.data;
    const candidates = (): Record<string, Array<{ name: string }>> =>
      JSON.parse((fakeLlmState.structuredInputs.at(-1) as Array<{ content: string }>)[0].content)
        .recipes;
    const names = (meal: string): string[] => candidates()[meal].map(({ name }) => name);

    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.request = 'Plan a one-day menu without peanuts.';
    fakeLlmState.menuRequest = {
      ...EMPTY_MENU_REQUEST,
      days: 1,
      mealTypes: [MealType.Breakfast, MealType.Lunch, MealType.Snack, MealType.Dinner],
      excludedIngredients: ['peanut'],
    };
    fakeLlmState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });
    const first = menuOf((await say(id, 'Plan my day, no peanuts')).chunks);
    expect(names('dinner')).not.toContain('Peanut satay');
    expect(names('lunch')).toContain('Chicken with rice');

    fakeLlmState.intent = Intent.ReviseMenu;
    fakeLlmState.request = 'Plan a one-day menu without chicken.';
    fakeLlmState.menuRequest = { ...EMPTY_MENU_REQUEST, excludedIngredients: ['chicken'] };
    fakeLlmState.menuPlan = fakeMenuPlan('Here is your day without chicken.', {
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
    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });

    const { chunks } = await say(id, 'Plan my day');

    const [, planned] = fakeLlmState.structuredInputs as Array<Array<{ content: string }>>;
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
    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });

    await say(id, 'Plan my day');

    const [, planned] = fakeLlmState.structuredInputs as Array<Array<{ content: string }>>;
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
    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.menuPlan = fakeMenuPlan('Here is your day.', {
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
    expect(fakeLlmState.structuredInputs).toHaveLength(1 + MENU_PLAN_MAX_ATTEMPTS);
    expect(await savedMessages(id)).toEqual([{ role: 'user', content: 'Plan my day' }]);
  });

  it('answers without the model when a meal has no allowed recipe, naming the diet', async () => {
    await createMenuWorld(ctx);
    await http()
      .post('/api/preferences')
      .send({ preferenceType: 'diet', value: 'vegan' })
      .expect(201);
    const id = await start();
    fakeLlmState.intent = Intent.GenerateMenu;

    const { chunks } = await say(id, 'Plan my day');

    expect(textOf(chunks)).toBe(
      "I can't plan a good 1-day menu: the vegan diet leaves no lunches, and it needs at least 1 recipe for every meal. To get a good menu, you could remove the vegan diet from your profile. Which would you like?",
    );
    expect(chunks.some((chunk) => chunk.type === 'data-menu')).toBe(false);
  });

  it('explains which rules leave too few recipes for the days before asking the model, then plans the fewer days offered', async () => {
    await createMenuWorld(ctx);
    await addRiceRecipes(ctx, 3);
    await addLentilStew(ctx);
    await http()
      .post('/api/preferences')
      .send({ preferenceType: 'diet', value: 'vegan' })
      .expect(201);
    const id = await start();
    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.menuRequest = { ...menuRequest, days: 7, excludedIngredients: ['lentils'] };

    const { chunks } = await say(id, 'A vegan week without lentils');

    const reply =
      "I can't plan a good 7-day menu: the vegan diet and excluding lentils leave 3 lunches, and it needs at least 4 different recipes for every meal. To get a good menu, you could remove the vegan diet from your profile, allow lentils or plan 6 days instead of 7. Which would you like?";
    expect(textOf(chunks)).toBe(reply);
    expect(chunks.some((chunk) => chunk.type === 'data-menu-pending')).toBe(false);
    expect(chunks.some((chunk) => chunk.type === 'data-menu')).toBe(false);
    // Only the classification: the planner never reached the model.
    expect(fakeLlmState.structuredInputs).toHaveLength(1);
    expect(await savedMessages(id)).toEqual([
      { role: 'user', content: 'A vegan week without lentils' },
      { role: 'assistant', content: reply },
    ]);

    fakeLlmState.menuRequest = { ...menuRequest, days: 6 };
    fakeLlmState.menuPlan = fakeMenuPlan(
      'Here are your days.',
      { breakfast: 'Oatmeal', lunch: 'Rice lunch 1', dinner: 'Rice bowl' },
      6,
    );
    const next = await say(id, 'Plan 6 days then');

    const menu = next.chunks.find((chunk) => chunk.type === 'data-menu')?.data.composition;
    expect(menu.days).toHaveLength(6);
    expect(await storedMenuRequest(id)).toEqual({
      ...menuRequest,
      days: 6,
      excludedIngredients: ['lentils'],
    });
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
    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.menuPlan = fakeMenuPlan('Here is your day.', {
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
    fakeLlmState.intent = Intent.Clarification;

    const { chunks } = await say(id, 'Make a menu');

    expect(textOf(chunks)).toBe(CLARIFICATION_REPLY);
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'data-clarification',
        data: { missingFields: ['days', 'mealTypes'] },
      }),
    );
    expect(fakeLlmState.streamTextCalls).toBe(0);
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
    wishes: null,
  };

  it('keeps the answer to a clarification in the conversation for later requests', async () => {
    await createMenuWorld(ctx);
    await addRiceRecipes(ctx, 1);
    await addLentilStew(ctx);
    const id = await start();
    fakeLlmState.intent = Intent.Clarification;
    await say(id, 'Make a menu');
    expect(await storedMenuRequest(id)).toBeNull();

    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.menuRequest = {
      ...menuRequest,
      days: 3,
      mealTypes: [MealType.Breakfast, MealType.Dinner],
      excludedIngredients: ['mushrooms'],
    };
    fakeLlmState.menuPlan = fakeMenuPlan(
      'Here are your days.',
      { breakfast: 'Oatmeal', lunch: 'Chicken with rice', dinner: 'Rice bowl' },
      3,
    );
    await say(id, '3 days, breakfast and dinner, no mushrooms');
    expect(await storedMenuRequest(id)).toEqual(fakeLlmState.menuRequest);

    fakeLlmState.menuRequest = { ...menuRequest, diets: [DietTag.Vegetarian] };
    fakeLlmState.menuPlan = fakeMenuPlan(
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

    fakeLlmState.intent = Intent.Clarification;
    fakeLlmState.menuRequest = null;
    fakeLlmState.structuredInputs = [];
    const { chunks } = await say(id, 'and another one');
    expect(chunks.some((chunk) => chunk.type === 'data-clarification')).toBe(false);
    expect(chunks.some((chunk) => chunk.type === 'data-menu')).toBe(true);
    const [, planned] = fakeLlmState.structuredInputs as Array<Array<{ content: string }>>;
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
      fakeLlmState.intent = Intent.GenerateMenu;
      fakeLlmState.menuRequest = { ...menuRequest, days: requested };

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
    fakeLlmState.intent = 'unavailable';

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
    expect(fakeLlmState.streamTextCalls).toBe(0);
    expect(await savedMessages(id)).toEqual([{ role: 'user', content: 'Hi' }]);
  });

  it('reports invalid model output with its own error and saves no reply', async () => {
    await createMenuWorld(ctx);
    const id = await start();
    fakeLlmState.intent = 'invalid';

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

  describe('long conversations', () => {
    /** An earlier chat: `count` user and assistant messages of the longest length, and its menu request. */
    const seedChat = async (id: string, count: number): Promise<void> => {
      const startedAt = Date.now() - 3_600_000;
      await ctx.prisma.message.createMany({
        data: Array.from({ length: count }, (_, index) => ({
          conversationId: id,
          role: index % 2 === 0 ? MessageRole.User : MessageRole.Assistant,
          content: `${index} ${'x'.repeat(MESSAGE_MAX_LENGTH - 4)}`,
          createdAt: new Date(startedAt + index * 1000),
        })),
      });
      await ctx.prisma.conversation.update({
        where: { id },
        data: { menuRequest: { ...menuRequest, days: 3, excludedIngredients: ['mushrooms'] } },
      });
    };

    it('keeps the history within the budget, summarizes the older messages and does not lose the days and constraints', async () => {
      await createMenuWorld(ctx);
      await addRiceRecipes(ctx, 1);
      const id = await start();
      await seedChat(id, 40);

      await say(id, 'Thanks!');

      const [classified, summarized] = fakeLlmState.structuredInputs as Array<
        Array<{ role: string; content: string }>
      >;
      const history = classified.slice(1);
      expect(history.at(-1)).toEqual({ role: 'user', content: 'Thanks!' });
      expect(history.length).toBeLessThan(42);
      expect(
        history.reduce((sum, message) => sum + estimateTokens(message.content), 0),
      ).toBeLessThanOrEqual(MODEL_HISTORY_MAX_TOKENS);
      expect(JSON.parse(classified[0].content).menuRequest).toMatchObject({
        days: 3,
        excludedIngredients: ['mushrooms'],
      });
      expect(JSON.parse(summarized[0].content).earlierSummary).toBeNull();

      const stored = await ctx.prisma.conversation.findUniqueOrThrow({ where: { id } });
      expect(stored.summary).toBe(FAKE_SUMMARY);
      expect(stored.lastSummarizedMessageId).not.toBeNull();

      fakeLlmState.intent = Intent.GenerateMenu;
      fakeLlmState.menuRequest = { ...menuRequest, mealTypes: [MealType.Breakfast] };
      fakeLlmState.menuPlan = fakeMenuPlan(
        'Here are your days.',
        { breakfast: 'Oatmeal', lunch: 'Chicken with rice', dinner: 'Rice bowl' },
        3,
      );
      fakeLlmState.structuredInputs = [];
      const { chunks } = await say(id, 'A menu with breakfast');

      const [reclassified, planned] = fakeLlmState.structuredInputs as Array<
        Array<{ role: string; content: string }>
      >;
      expect(JSON.parse(reclassified[0].content)).toMatchObject({
        earlierConversation: FAKE_SUMMARY,
        menuRequest: { days: 3, excludedIngredients: ['mushrooms'] },
      });
      expect(reclassified.slice(1).map(({ content }) => content.split(' ')[0])).toEqual([
        '38',
        '39',
        'Thanks!',
        FAKE_OPEN_AI_DELTAS.join('').split(' ')[0],
        'A',
      ]);
      expect(JSON.parse(planned[0].content).days).toBe(3);
      expect(chunks.some((chunk) => chunk.type === 'data-menu')).toBe(true);
      expect(await storedMenuRequest(id)).toEqual({
        ...menuRequest,
        days: 3,
        mealTypes: [MealType.Breakfast],
        excludedIngredients: ['mushrooms'],
      });
    });

    it('answers a full conversation with an error and starts a new one with its menu details', async () => {
      const world = await createMenuWorld(ctx);
      const menuId = await seedMenu(ctx, 'Week', [
        {
          dayIndex: 0,
          meals: [{ mealType: 'lunch', recipeId: world.recipe.chicken, servings: 1 }],
        },
      ]);
      const id = await start({ menuId });
      await seedChat(id, 2 * CONVERSATION_MAX_USER_MESSAGES);

      const { status, chunks } = await say(id, 'One more?');

      expect(status).toBe(201);
      expect(chunks.slice(-2)).toEqual([
        expect.objectContaining({
          type: 'data-error',
          data: {
            code: ChatErrorCode.ConversationLimitReached,
            message: CONVERSATION_LIMIT_REPLY,
            retryable: false,
          },
        }),
        { type: 'error', errorText: CONVERSATION_LIMIT_REPLY },
      ]);
      expect(fakeLlmState.structuredInputs).toEqual([]);
      expect(await ctx.prisma.message.count({ where: { conversationId: id } })).toBe(
        2 * CONVERSATION_MAX_USER_MESSAGES,
      );

      const next = await http()
        .post('/api/conversations')
        .send({ fromConversationId: id })
        .expect(201);
      expect(next.body).toMatchObject({ menuId, messages: [] });
      expect(await storedMenuRequest(next.body.id)).toEqual({
        ...menuRequest,
        days: 3,
        excludedIngredients: ['mushrooms'],
      });

      await http()
        .post('/api/conversations')
        .send({ fromConversationId: '2b1e7f3a-5d47-4a8e-9f6c-1d2e3f4a5b6c' })
        .expect(404);
    });
  });
});
