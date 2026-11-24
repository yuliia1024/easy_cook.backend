import {
  ChatToolErrorCode,
  ChatToolName,
  Intent,
  MENU_SAVE_QUESTION,
  SaveMenuStatus,
} from '../src/common/constants';
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

/**
 * "Save the menu" in the chat: the chat model calls `save_menu`, which confirms the latest menu the
 * conversation suggested exactly as `POST /menus/:id/versions/:versionId/confirm` does.
 */
describe('save_menu (e2e)', () => {
  let ctx: TestApp;
  const http = () => ctx.http();
  const start = async (): Promise<string> =>
    (await http().post('/api/conversations').send({}).expect(201)).body.id;
  const say = async (id: string, content: string): Promise<StreamChunk[]> =>
    (
      await readStream(
        http().post(`/api/conversations/${id}/messages`).send({ content }).expect(201),
      )
    ).chunks;
  const textOf = (chunks: StreamChunk[]): string =>
    chunks
      .filter((chunk) => chunk.type === 'text-delta')
      .map((chunk) => chunk.delta)
      .join('');
  const dataOf = (chunks: StreamChunk[], type: string): any =>
    chunks.find((chunk) => chunk.type === type)?.data;

  /** Plans a one-day menu in the conversation; returns the ids of its draft version. */
  const planDay = async (id: string): Promise<{ menuId: string; versionId: string }> => {
    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.request = 'Plan a one-day menu.';
    fakeLlmState.menuRequest = { ...EMPTY_MENU_REQUEST, days: 1 };
    fakeLlmState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });
    const chunks = await say(id, 'Plan my day');
    const { menuId, versionId } = dataOf(chunks, 'data-menu');
    resetFakeLlm();
    return { menuId, versionId };
  };
  /** The chat model answers the next message with `save_menu`, as many times as given. */
  const modelSaves = (times = 1, input: object = {}): void => {
    fakeLlmState.intent = Intent.GeneralChat;
    fakeLlmState.toolResults = [];
    fakeLlmState.toolCalls = Array.from({ length: times }, () => ({
      toolName: ChatToolName.SaveMenu,
      input,
    }));
  };
  const menuOf = async (menuId: string) =>
    (await http().get(`/api/menus/${menuId}`).expect(200)).body;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    resetFakeLlm();
    await resetRateLimits();
    await createMenuWorld(ctx);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('asks whether to save after the menu, in a text part of its own, and saves it in the reply', async () => {
    const id = await start();
    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.request = 'Plan a one-day menu.';
    fakeLlmState.menuRequest = { ...EMPTY_MENU_REQUEST, days: 1 };
    fakeLlmState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });

    const chunks = await say(id, 'Plan my day');

    const types = chunks.map(({ type, id: partId }) => (partId ? `${type}:${partId}` : type));
    expect(types.slice(types.indexOf('data-menu') - 1)).toEqual([
      'text-end:text',
      'data-menu',
      'text-start:text-2',
      'text-delta:text-2',
      'text-end:text-2',
      'finish',
    ]);
    expect(textOf(chunks)).toBe(`Here is your day.${MENU_SAVE_QUESTION}`);
    const { body } = await http().get(`/api/conversations/${id}`).expect(200);
    expect(body.messages[1].content).toBe(`Here is your day.\n\n${MENU_SAVE_QUESTION}`);
  });

  it('confirms the draft on "save the menu": GET /menus lists it and the stream says so', async () => {
    const id = await start();
    const { menuId, versionId } = await planDay(id);
    await http().get('/api/menus').expect(200, []);
    // Ids the model makes up are dropped: the conversation names the menu.
    modelSaves(1, { menuId: '0b6e5c1e-3f0a-4d2b-9c8e-7a6b5c4d3e2f' });

    const chunks = await say(id, 'Save the menu');

    expect(fakeLlmState.toolResults).toEqual([
      { status: SaveMenuStatus.Saved, title: '1-day menu' },
    ]);
    expect(dataOf(chunks, 'data-menu-saved')).toEqual({ menuId, versionId });
    expect(
      chunks.filter(({ type }) => type === 'data-status').map(({ data }) => data.step),
    ).toEqual(['thinking', 'saving_menu']);
    expect(textOf(chunks)).toBe(FAKE_OPEN_AI_DELTAS.join(''));
    expect(chunks.at(-1)).toMatchObject({ type: 'finish' });
    const { body: menus } = await http().get('/api/menus').expect(200);
    expect(menus).toEqual([
      expect.objectContaining({ id: menuId, confirmedVersionId: versionId, versionCount: 1 }),
    ]);
  });

  it('gives the same menu as the confirm button', async () => {
    const byChat = await start();
    const chatDraft = await planDay(byChat);
    const byButton = await start();
    const buttonDraft = await planDay(byButton);

    modelSaves();
    await say(byChat, 'Save it');
    await http()
      .post(`/api/menus/${buttonDraft.menuId}/versions/${buttonDraft.versionId}/confirm`)
      .expect(200);

    const comparable = (menu: any) => ({
      title: menu.title,
      confirmed: menu.confirmedVersionId === menu.versions[0].id,
      confirmedAt: typeof menu.confirmedAt,
      versions: menu.versions.map(({ isConfirmed, days }: any) => ({
        isConfirmed,
        meals: days.map(({ meals }: any) =>
          meals.map(({ mealType, recipeId, servings }: any) => ({ mealType, recipeId, servings })),
        ),
      })),
    });
    const saved = await menuOf(chatDraft.menuId);
    expect(comparable(saved)).toEqual(comparable(await menuOf(buttonDraft.menuId)));
    expect(comparable(saved)).toMatchObject({ confirmed: true, confirmedAt: 'string' });
    const { body: menus } = await http().get('/api/menus').expect(200);
    expect(menus.map(({ id }: { id: string }) => id).sort()).toEqual(
      [chatDraft.menuId, buttonDraft.menuId].sort(),
    );
  });

  it('answers in text when the conversation has no menu yet, saving nothing', async () => {
    const id = await start();
    modelSaves();

    const chunks = await say(id, 'Save the menu');

    expect(fakeLlmState.toolResults).toEqual([
      {
        error: ChatToolErrorCode.NotFound,
        message: 'This conversation has no menu to save yet: plan one first.',
      },
    ]);
    expect(chunks.some(({ type }) => type === 'error' || type === 'data-menu-saved')).toBe(false);
    expect(textOf(chunks)).toBe(FAKE_OPEN_AI_DELTAS.join(''));
    expect(await ctx.prisma.menu.count()).toBe(0);
  });

  it('says a saved menu is saved already, without confirming it again', async () => {
    const id = await start();
    const { menuId, versionId } = await planDay(id);
    modelSaves();
    await say(id, 'Save the menu');
    const { confirmedAt } = await menuOf(menuId);
    modelSaves();

    const chunks = await say(id, 'Save it again');

    expect(fakeLlmState.toolResults).toEqual([
      { status: SaveMenuStatus.AlreadySaved, title: '1-day menu' },
    ]);
    expect(dataOf(chunks, 'data-menu-saved')).toEqual({ menuId, versionId });
    expect(await menuOf(menuId)).toMatchObject({ confirmedVersionId: versionId, confirmedAt });
    expect(await ctx.prisma.menu.count()).toBe(1);
    expect(await ctx.prisma.menuVersion.count()).toBe(1);
  });

  it('saves the steps of the model with its reply', async () => {
    const id = await start();
    await planDay(id);
    modelSaves(2);

    await say(id, 'Save the menu');

    const reply = await ctx.prisma.message.findFirstOrThrow({
      where: { conversationId: id, role: 'assistant' },
      orderBy: { createdAt: 'desc' },
      include: { toolCalls: { orderBy: { position: 'asc' } } },
    });
    expect(
      reply.toolCalls.map(({ position, toolName, input, output, error }) => ({
        position,
        toolName,
        input,
        output,
        error,
      })),
    ).toEqual([
      {
        position: 0,
        toolName: ChatToolName.SaveMenu,
        input: {},
        output: { status: SaveMenuStatus.Saved, title: '1-day menu' },
        error: null,
      },
      {
        position: 1,
        toolName: ChatToolName.SaveMenu,
        input: {},
        output: {
          error: ChatToolErrorCode.Rejected,
          message: `${ChatToolName.SaveMenu} was already called in this reply.`,
        },
        error: ChatToolErrorCode.Rejected,
      },
    ]);
  });

  it('rejects a second save_menu in the same reply', async () => {
    const id = await start();
    await planDay(id);
    modelSaves(2);

    await say(id, 'Save the menu');

    expect(fakeLlmState.toolResults).toEqual([
      expect.objectContaining({ status: SaveMenuStatus.Saved }),
      {
        error: ChatToolErrorCode.Rejected,
        message: `${ChatToolName.SaveMenu} was already called in this reply.`,
      },
    ]);
  });

  it('refuses a draft that breaks the preferences now, leaving it a draft, never a 500', async () => {
    const id = await start();
    const { menuId } = await planDay(id);
    await http()
      .post('/api/preferences')
      .send({ preferenceType: 'excluded_ingredient', value: 'chicken' })
      .expect(201);
    modelSaves();

    const chunks = await say(id, 'Save the menu');

    expect(fakeLlmState.toolResults).toEqual([
      {
        error: ChatToolErrorCode.Rejected,
        message: expect.stringContaining('Chicken with rice contains Chicken breast, cooked'),
      },
    ]);
    expect(chunks.some(({ type }) => type === 'error' || type === 'data-menu-saved')).toBe(false);
    expect(textOf(chunks)).toBe(FAKE_OPEN_AI_DELTAS.join(''));
    expect(await menuOf(menuId)).toMatchObject({ confirmedVersionId: null });
  });
});
