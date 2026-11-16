import { createPrismaMock, PrismaMock } from '../../../test/prisma-mock';
import { AgentRunData, AgentRunRepository } from './agent-run.repository';

describe('AgentRunRepository', () => {
  let prisma: PrismaMock;
  let repository: AgentRunRepository;

  beforeEach(() => {
    prisma = createPrismaMock();
    repository = new AgentRunRepository(prisma);
  });

  it('adds a run with its model and tool calls as JSON', async () => {
    const data: AgentRunData = {
      requestId: 'req-1',
      conversationId: 'conv-1',
      userMessageId: 'msg-1',
      replyMessageId: null,
      outcome: 'failed',
      durationMs: 1200,
      firstTextMs: null,
      modelCallCount: 1,
      unfinishedModelCallCount: 1,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      toolCallCount: 1,
      failedToolCallCount: 0,
      modelCalls: [{ prompt: 'chat@v1', usage: null }],
      toolCalls: [{ toolCallId: 'call_1', name: 'save_menu' }],
    };
    prisma.agentRun.create.mockResolvedValue({ id: 'run-1' } as never);

    await expect(repository.create(data)).resolves.toEqual({ id: 'run-1' });
    expect(prisma.agentRun.create).toHaveBeenCalledWith({ data });
  });
});
