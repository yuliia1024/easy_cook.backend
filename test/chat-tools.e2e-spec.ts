import {
  CHAT_TOOL_MAX_STEPS,
  ChatToolErrorCode,
  ChatToolName,
  ChatTraceOutcome,
  ChatTraceStep,
  daysOutOfRangeReply,
  Intent,
  MENU_MAX_DAYS,
  MENU_SAVE_QUESTION,
} from '../src/common/constants';
import { ChatTrace } from '../src/modules/services/chat-trace/chat-trace';
import { RecipeIndexService } from '../src/modules/services/recipe-search/recipe-index.service';
import { ChatTraceService } from '../src/modules/services/chat-trace/chat-trace.service';
import { EMPTY_MENU_REQUEST } from '../src/modules/services/menu/menu-request';
import { createMenuWorld } from './menu-fixtures';
import { readStream, StreamChunk } from './menu-stream';
import {
  createTestApp,
  FAKE_OPEN_AI_DELTAS,
  fakeMenuPlan,
  fakeLlmState,
  resetDatabase,
  resetFakeLlm,
  resetRateLimits,
  TestApp,
} from './test-app';

/** The chat model's tools on the real services and the test database, run by the fake model. */
describe('chat tools (e2e)', () => {
  let ctx: TestApp;
  const http = () => ctx.http();
  const start = async (): Promise<string> =>
    (await http().post('/api/conversations').send({}).expect(201)).body.id;
  const say = (id: string, content: string) =>
    readStream(http().post(`/api/conversations/${id}/messages`).send({ content }).expect(201));
  const textOf = (chunks: StreamChunk[]): string =>
    chunks
      .filter((chunk) => chunk.type === 'text-delta')
      .map((chunk) => chunk.delta)
      .join('');
  const savedMessages = async (id: string) =>
    (await http().get(`/api/conversations/${id}`).expect(200)).body.messages.map(
      ({ role, content }: { role: string; content: string }) => ({ role, content }),
    );
  const search = {
    query: null,
    mealType: null,
    diet: null,
    maxKcalPerServing: null,
    maxPrepTimeMinutes: null,
    limit: null,
  };
  /** The recipes of the world in the search index (fake embeddings), as `npm run search:index` does. */
  const indexRecipes = async (): Promise<void> => {
    await ctx.app.get(RecipeIndexService).sync();
  };
  const menuRequest = { ...EMPTY_MENU_REQUEST, days: 1 };

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

  it('runs a tool loop over the recipes and the nutrition maths, then answers', async () => {
    const { recipe } = await createMenuWorld(ctx);
    await indexRecipes();
    const id = await start();
    type Results = [
      { recipes: Array<{ id: string }> },
      unknown,
      { foods: Array<{ id: string }> },
      unknown,
    ];
    fakeLlmState.toolCalls = [
      {
        toolName: ChatToolName.SearchRecipes,
        input: { ...search, query: 'chicken with rice', limit: 1 },
      },
      {
        toolName: ChatToolName.GetRecipeDetails,
        input: ([found]: Results) => ({ recipeId: found.recipes[0].id }),
      },
      { toolName: ChatToolName.GetFoodNutrition, input: { query: 'rice', quantityG: 200 } },
      {
        toolName: ChatToolName.CalculateNutrition,
        input: ([, , rice]: Results) => ({
          items: [{ foodId: rice.foods[0].id, quantityG: 200 }],
          servings: 2,
        }),
      },
    ];

    const { chunks } = await say(id, 'What is in the chicken with rice?');

    const [found, details, food, calculated] = fakeLlmState.toolResults;
    expect(found).toEqual({
      recipes: [
        {
          id: recipe.chicken,
          name: 'Chicken with rice',
          mealType: 'lunch',
          diets: [],
          servings: 1,
          prepTimeMinutes: null,
          perServing: { kcal: 655, proteinG: 68.8, fatG: 8, carbsG: 70 },
          complete: true,
          fitsProfile: true,
        },
      ],
      more: true,
      similar: [],
    });
    expect(details).toMatchObject({
      id: recipe.chicken,
      instructions: 'Cook.',
      ingredients: [
        { foodName: 'Chicken breast, cooked', quantityG: 200, isOptional: false },
        { foodName: 'Rice, boiled', quantityG: 250, isOptional: false },
      ],
    });
    expect(food).toMatchObject({
      foods: [
        {
          name: 'Rice, boiled',
          per100g: { kcal: 130, proteinG: 2.7, fatG: 0.3, carbsG: 28 },
          quantityG: 200,
          forQuantity: { kcal: 260, proteinG: 5.4, fatG: 0.6, carbsG: 56 },
        },
      ],
    });
    expect(calculated).toMatchObject({
      servings: 2,
      total: { kcal: 260, proteinG: 5.4, fatG: 0.6, carbsG: 56 },
      perServing: { kcal: 130, proteinG: 2.7, fatG: 0.3, carbsG: 28 },
      complete: true,
    });
    expect(textOf(chunks)).toBe(FAKE_OPEN_AI_DELTAS.join(''));
    expect(chunks.at(-1)).toMatchObject({ type: 'finish' });
    expect(
      chunks.filter((chunk) => chunk.type === 'data-status').map((chunk) => chunk.data),
    ).toEqual([
      { step: 'thinking', message: 'Thinking' },
      { step: 'searching_recipes', message: 'Searching recipes' },
      { step: 'reading_recipe', message: 'Reading the recipe' },
      { step: 'checking_nutrition', message: 'Looking up nutrition values' },
      { step: 'calculating_nutrition', message: 'Calculating calories' },
    ]);
    expect(
      chunks.filter((chunk) => chunk.type === 'data-status').every((chunk) => chunk.transient),
    ).toBe(true);
    expect(await savedMessages(id)).toEqual([
      { role: 'user', content: 'What is in the chicken with rice?' },
      { role: 'assistant', content: FAKE_OPEN_AI_DELTAS.join('') },
    ]);
  });

  it('hands invalid arguments and unknown ids back to the model and still answers, never a 500', async () => {
    await createMenuWorld(ctx);
    const id = await start();
    const unknownId = '0b6e5c1e-3f0a-4d2b-9c8e-7a6b5c4d3e2f';
    fakeLlmState.toolCalls = [
      { toolName: ChatToolName.GetRecipeDetails, input: { recipeId: 'Rice bowl' } },
      { toolName: ChatToolName.GetRecipeDetails, input: { recipeId: unknownId } },
      {
        toolName: ChatToolName.CalculateNutrition,
        input: { items: [{ foodId: unknownId, quantityG: 100 }], servings: null },
      },
      { toolName: ChatToolName.SearchRecipes, input: { query: 'rice' } },
    ];

    const { chunks } = await say(id, 'Tell me about the rice bowl');

    expect(fakeLlmState.toolResults).toEqual([
      {
        error: ChatToolErrorCode.InvalidArguments,
        message: expect.any(String),
        issues: [expect.stringMatching(/^recipeId: /)],
      },
      { error: ChatToolErrorCode.NotFound, message: 'Recipe not found' },
      { error: ChatToolErrorCode.Rejected, message: `Food items not found: ${unknownId}` },
      {
        error: ChatToolErrorCode.InvalidArguments,
        message: expect.any(String),
        issues: expect.arrayContaining([expect.stringMatching(/^mealType: /)]),
      },
    ]);
    expect(chunks.some((chunk) => chunk.type === 'error')).toBe(false);
    expect(textOf(chunks)).toBe(FAKE_OPEN_AI_DELTAS.join(''));
  });

  it(`stops the tools after ${CHAT_TOOL_MAX_STEPS - 1} steps and answers in the last one`, async () => {
    await createMenuWorld(ctx);
    const id = await start();
    fakeLlmState.toolCalls = Array.from({ length: 10 }, () => ({
      toolName: ChatToolName.SearchRecipes,
      input: search,
    }));

    const { chunks } = await say(id, 'Show me every recipe');

    expect(fakeLlmState.toolResults).toHaveLength(CHAT_TOOL_MAX_STEPS - 1);
    expect(textOf(chunks)).toBe(FAKE_OPEN_AI_DELTAS.join(''));
  });

  it('traces the chain of a message: request, intent, tool calls with results, saved reply', async () => {
    await createMenuWorld(ctx);
    const id = await start();
    const traceService = ctx.app.get(ChatTraceService);
    jest
      .spyOn(traceService, 'start')
      .mockImplementation(
        (conversationId, content) => new ChatTrace(true, conversationId, content),
      );
    const finish = jest.spyOn(traceService, 'finish').mockImplementation();
    await indexRecipes();
    fakeLlmState.toolCalls = [
      { toolName: ChatToolName.SearchRecipes, input: { ...search, query: 'bowl' } },
      { toolName: ChatToolName.GetRecipeDetails, input: { recipeId: 'Rice bowl' } },
    ];

    try {
      await say(id, 'Tell me about the rice bowl');

      expect(finish).toHaveBeenCalledTimes(1);
      const [trace, outcome] = finish.mock.calls[0];
      const record = trace.toRecord(outcome);
      expect(record).toMatchObject({
        conversationId: id,
        request: { content: 'Tell me about the rice bowl' },
        outcome: ChatTraceOutcome.Replied,
      });
      const steps = (step: ChatTraceStep): unknown[] =>
        record.steps.filter((entry) => entry.step === step).map(({ data }) => data);
      expect(steps(ChatTraceStep.Intent)).toEqual([
        expect.objectContaining({ intent: Intent.GeneralChat }),
      ]);
      expect(steps(ChatTraceStep.ToolCall)).toEqual([
        expect.objectContaining({
          name: ChatToolName.SearchRecipes,
          input: { ...search, query: 'bowl' },
          output: expect.objectContaining({
            // Best first; the fake embeddings, not calibrated, list the other recipes after it.
            recipes: expect.arrayContaining([expect.objectContaining({ name: 'Rice bowl' })]),
          }),
          error: null,
        }),
        expect.objectContaining({
          name: ChatToolName.GetRecipeDetails,
          error: ChatToolErrorCode.InvalidArguments,
        }),
      ]);
      expect(steps(ChatTraceStep.Saved)).toEqual([
        {
          content: FAKE_OPEN_AI_DELTAS.join(''),
          menuVersionId: null,
          preferenceChange: null,
          wishOffer: null,
        },
      ]);
      expect(() => JSON.stringify(record)).not.toThrow();
    } finally {
      jest.restoreAllMocks();
    }
  });

  describe('menu tools', () => {
    it('plans the menu plan_menu asks for through the planner, its checks and a saved version', async () => {
      const { recipe } = await createMenuWorld(ctx);
      const id = await start();
      fakeLlmState.intent = Intent.GeneralChat;
      fakeLlmState.menuPlan = fakeMenuPlan('Here is your day.', {
        breakfast: 'Oatmeal',
        lunch: 'Chicken with rice',
        dinner: 'Rice bowl',
      });
      fakeLlmState.toolCalls = [
        {
          toolName: ChatToolName.PlanMenu,
          input: { request: 'Plan a one-day menu.', menuRequest },
        },
      ];

      const { chunks } = await say(id, 'Sounds good, make it');

      expect(fakeLlmState.toolResults).toEqual([expect.objectContaining({ status: 'accepted' })]);
      expect(textOf(chunks)).toBe(`Here is your day.${MENU_SAVE_QUESTION}`);
      const menu = chunks.find((chunk) => chunk.type === 'data-menu')?.data;
      expect(
        menu.composition.days[0].meals.map(({ recipeId }: { recipeId: string }) => recipeId),
      ).toEqual([recipe.oats, recipe.chicken, recipe.snack, recipe.bowl]);
      const { body } = await http().get(`/api/conversations/${id}`).expect(200);
      expect(body.messages[1]).toMatchObject({
        content: `Here is your day.\n\n${MENU_SAVE_QUESTION}`,
        menuVersionId: menu.versionId,
      });
      const version = await ctx.prisma.menuVersion.findUniqueOrThrow({
        where: { id: menu.versionId },
      });
      expect(version.notes).toContain('menu-plan@v1');
      expect(
        (await ctx.prisma.conversation.findUniqueOrThrow({ where: { id } })).menuRequest,
      ).toEqual(menuRequest);
    });

    it('asks about too many days instead of planning, as a classified request does', async () => {
      await createMenuWorld(ctx);
      const id = await start();
      fakeLlmState.toolCalls = [
        {
          toolName: ChatToolName.PlanMenu,
          input: { request: 'Plan a 30-day menu.', menuRequest: { ...menuRequest, days: 30 } },
        },
      ];

      const { chunks } = await say(id, 'A month of meals, please');

      expect(textOf(chunks)).toBe(daysOutOfRangeReply(30, MENU_MAX_DAYS));
      expect(chunks).toContainEqual(
        expect.objectContaining({ type: 'data-clarification', data: { missingFields: ['days'] } }),
      );
      expect(chunks.some((chunk) => chunk.type === 'data-menu')).toBe(false);
      expect(await ctx.prisma.menu.count()).toBe(0);
    });

    it('plans nothing for plan_menu with invalid arguments and lets the model answer', async () => {
      await createMenuWorld(ctx);
      const id = await start();
      fakeLlmState.toolCalls = [
        {
          toolName: ChatToolName.PlanMenu,
          input: {
            request: 'Plan a menu.',
            menuRequest: { ...menuRequest, mealTypes: ['brunch'] },
          },
        },
      ];

      const { chunks } = await say(id, 'Make a brunch menu');

      expect(fakeLlmState.toolResults).toEqual([
        expect.objectContaining({ error: ChatToolErrorCode.InvalidArguments }),
      ]);
      expect(textOf(chunks)).toBe(FAKE_OPEN_AI_DELTAS.join(''));
      expect(await ctx.prisma.menu.count()).toBe(0);
    });
  });
});
