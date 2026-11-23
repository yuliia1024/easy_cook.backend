import request from 'supertest';
import { ChatToolName, ChatTraceOutcome, Intent } from '../src/common/constants';
import { EMPTY_MENU_REQUEST } from '../src/modules/services/menu/menu-request';
import { createMenuWorld } from './menu-fixtures';
import { readStream } from './menu-stream';
import {
  createTestApp,
  fakeMenuPlan,
  fakeLlmState,
  resetDatabase,
  resetFakeLlm,
  resetRateLimits,
  TestApp,
} from './test-app';

/** The audit log of the chat agent: one `agent_runs` row per user message, whatever the outcome. */
describe('agent runs (e2e)', () => {
  let ctx: TestApp;
  const http = () => request(ctx.app.getHttpServer());
  const start = async (): Promise<string> =>
    (await http().post('/api/conversations').send({}).expect(201)).body.id;
  const say = async (id: string, content: string, requestId = 'req-e2e'): Promise<void> => {
    await readStream(
      http()
        .post(`/api/conversations/${id}/messages`)
        .set('x-request-id', requestId)
        .send({ content })
        .expect(201),
    );
  };
  const messageOf = (conversationId: string, role: string) =>
    ctx.prisma.message.findFirst({
      where: { conversationId, role },
      orderBy: { createdAt: 'desc' },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    resetFakeLlm();
    resetRateLimits();
    await createMenuWorld(ctx);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('records a replied run with its request id, messages and the tool calls of the model', async () => {
    const id = await start();
    fakeLlmState.intent = Intent.GenerateMenu;
    fakeLlmState.request = 'Plan a one-day menu.';
    fakeLlmState.menuRequest = { ...EMPTY_MENU_REQUEST, days: 1 };
    fakeLlmState.menuPlan = fakeMenuPlan('Here is your day.', {
      breakfast: 'Oatmeal',
      lunch: 'Chicken with rice',
      dinner: 'Rice bowl',
    });
    await say(id, 'Plan my day', 'req-plan');
    resetFakeLlm();
    fakeLlmState.toolCalls = [{ toolName: ChatToolName.SaveMenu, input: {} }];

    await say(id, 'Save the menu', 'req-save');

    const runs = await ctx.prisma.agentRun.findMany({ orderBy: { createdAt: 'asc' } });
    expect(runs.map(({ requestId, outcome }) => ({ requestId, outcome }))).toEqual([
      { requestId: 'req-plan', outcome: ChatTraceOutcome.Replied },
      { requestId: 'req-save', outcome: ChatTraceOutcome.Replied },
    ]);
    const [, saveRun] = runs;
    expect(saveRun).toMatchObject({
      conversationId: id,
      userMessageId: (await messageOf(id, 'user'))!.id,
      replyMessageId: (await messageOf(id, 'assistant'))!.id,
      toolCallCount: 1,
      failedToolCallCount: 0,
      firstTextMs: expect.any(Number),
      toolCalls: [
        expect.objectContaining({ toolCallId: 'call_0', name: ChatToolName.SaveMenu, error: null }),
      ],
    });
  });

  it('records a failed run without a reply', async () => {
    const id = await start();
    fakeLlmState.intent = 'unavailable';

    await say(id, 'Hi');

    const run = await ctx.prisma.agentRun.findFirstOrThrow();
    expect(run).toMatchObject({
      conversationId: id,
      userMessageId: (await messageOf(id, 'user'))!.id,
      replyMessageId: null,
      outcome: ChatTraceOutcome.Failed,
    });
  });

  it('keeps the runs of a deleted conversation', async () => {
    const id = await start();
    await say(id, 'Hi');

    await http().delete(`/api/conversations/${id}`).expect(204);

    expect(await ctx.prisma.agentRun.findMany()).toEqual([
      expect.objectContaining({
        conversationId: null,
        userMessageId: null,
        replyMessageId: null,
        outcome: ChatTraceOutcome.Replied,
      }),
    ]);
  });
});
