import request from 'supertest';
import { createMenuWorld, seedMenu } from './menu-fixtures';
import { readStream } from './menu-stream';
import {
  ASSISTANT_INVALID_OUTPUT_REPLY,
  ASSISTANT_UNAVAILABLE_REPLY,
  ChatErrorCode,
  CLARIFICATION_REPLY,
  Intent,
  MenuIssueCode,
  MenuIssueSeverity,
  NO_MENU_RECIPES_REPLY,
  OUT_OF_SCOPE_REPLY,
} from '../src/common/constants';
import {
  createTestApp,
  FAKE_OPEN_AI_DELTAS,
  fakeOpenAiState,
  resetDatabase,
  resetFakeOpenAi,
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

  it('plans a one-day menu from the model choice and saves its message', async () => {
    const { recipe } = await createMenuWorld(ctx);
    const id = await start();
    fakeOpenAiState.intent = Intent.GenerateMenu;
    fakeOpenAiState.menuPlan = {
      message: 'Here is your day.',
      breakfast: recipe.oats,
      lunch: recipe.chicken,
      dinner: recipe.bowl,
    };

    const { chunks } = await say(id, 'Plan my day');

    expect(textOf(chunks)).toBe('Here is your day.');
    const menu = chunks.find((chunk) => chunk.type === 'data-menu')?.data;
    expect(menu.days).toHaveLength(1);
    expect(
      menu.days[0].meals.map((meal: { recipeId: string; servings: number }) => [
        meal.recipeId,
        meal.servings,
      ]),
    ).toEqual([
      [recipe.oats, 1],
      [recipe.chicken, 1],
      [recipe.bowl, 1],
    ]);
    expect(menu.days[0].totals.kcal).toBe(1619);
    expect(menu.issues).toEqual([
      expect.objectContaining({
        severity: MenuIssueSeverity.Warning,
        code: MenuIssueCode.CaloriesOffTarget,
        message: 'Day 1: 1619 kcal is 25 % below the 2172 kcal goal',
      }),
    ]);
    expect(fakeOpenAiState.streamTextCalls).toBe(0);
    expect(await savedMessages(id)).toEqual([
      { role: 'user', content: 'Plan my day' },
      { role: 'assistant', content: 'Here is your day.' },
    ]);
    const { body } = await http().get(`/api/conversations/${id}`).expect(200);
    expect(body.messages[0].suggestedMenu).toBeNull();
    expect(body.messages[1].suggestedMenu).toEqual(menu);
    expect(await ctx.prisma.menu.count()).toBe(0);
  });

  it('classifies a follow-up with the history and plans the restated request', async () => {
    const { recipe } = await createMenuWorld(ctx);
    const id = await start();
    await say(id, 'Plan my day');
    fakeOpenAiState.structuredInputs = [];
    fakeOpenAiState.intent = Intent.GenerateMenu;
    fakeOpenAiState.request = 'Plan a one-day menu.';
    fakeOpenAiState.menuPlan = {
      message: 'Here is your day.',
      breakfast: recipe.oats,
      lunch: recipe.chicken,
      dinner: recipe.bowl,
    };

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

  it('gives the planner the profile, marking a missing goal as not set, and finds no calorie issues', async () => {
    const { recipe } = await createMenuWorld(ctx, { goal: false });
    await http()
      .post('/api/preferences')
      .send({ preferenceType: 'allergy', value: 'peanut' })
      .expect(201);
    const id = await start();
    fakeOpenAiState.intent = Intent.GenerateMenu;
    fakeOpenAiState.menuPlan = {
      message: 'Here is your day.',
      breakfast: recipe.oats,
      lunch: recipe.chicken,
      dinner: recipe.bowl,
    };

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
    const menu = chunks.find((chunk) => chunk.type === 'data-menu')?.data;
    expect(menu.issues).toEqual([]);
  });

  it('reports a recipe outside the allowed ones as invalid output', async () => {
    const { recipe } = await createMenuWorld(ctx);
    await http()
      .post('/api/preferences')
      .send({ preferenceType: 'allergy', value: 'peanut' })
      .expect(201);
    const id = await start();
    fakeOpenAiState.intent = Intent.GenerateMenu;
    fakeOpenAiState.menuPlan = {
      message: 'Here is your day.',
      breakfast: recipe.oats,
      lunch: recipe.chicken,
      dinner: recipe.satay,
    };

    const { chunks } = await say(id, 'Plan my day');

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'data-error',
        data: expect.objectContaining({ code: ChatErrorCode.AssistantInvalidOutput }),
      }),
    );
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
    fakeOpenAiState.menuPlan = {
      message: 'Here is your day.',
      breakfast: recipe.oats,
      lunch,
      dinner: recipe.bowl,
    };

    const { chunks } = await say(id, 'Plan my day');

    const menu = chunks.find((chunk) => chunk.type === 'data-menu')?.data;
    expect(menu.days[0].meals.map((meal: { recipeId: string }) => meal.recipeId)).toEqual([
      recipe.oats,
      lunch,
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
        data: { missingFields: ['days', 'meals'] },
      }),
    );
    expect(fakeOpenAiState.streamTextCalls).toBe(0);
    expect(await ctx.prisma.menu.count()).toBe(0);
  });

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
