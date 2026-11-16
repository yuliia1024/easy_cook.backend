import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ChatToolName, ChatTraceOutcome } from '../../../common/constants';
import { createMock } from '../../../test/create-mock';
import { AgentRunRepository } from '../../data-access/agent-run/agent-run.repository';
import { AgentRunModule } from './agent-run.module';
import { AgentRunRecord, AgentRunService } from './agent-run.service';

describe('AgentRunService', () => {
  let repository: jest.Mocked<AgentRunRepository>;
  let service: AgentRunService;
  const modelCall = {
    prompt: 'chat@v1',
    provider: 'openai',
    modelId: 'gpt-test',
    step: 1,
    durationMs: 800,
    usage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 10 },
    finishReason: 'tool-calls',
  };
  const toolCall = {
    toolCallId: 'call_1',
    name: ChatToolName.SaveMenu,
    input: {},
    output: { menuId: 'menu-1' },
    error: null,
    durationMs: 5,
  };
  const run: AgentRunRecord = {
    requestId: 'req-1',
    conversationId: 'conv-1',
    userMessageId: 'msg-1',
    replyMessageId: null,
    summary: {
      outcome: ChatTraceOutcome.Failed,
      durationMs: 1500,
      firstTextMs: null,
      modelCalls: 2,
      unfinishedModelCalls: 1,
      usage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 10 },
      toolCalls: 1,
      failedToolCalls: 0,
    },
    modelCalls: [modelCall, { ...modelCall, step: 2, usage: null, finishReason: 'failed' }],
    toolCalls: [toolCall],
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    repository = createMock<AgentRunRepository>();
    service = new AgentRunService(repository);
  });

  it('is provided by AgentRunModule', async () => {
    const module = await Test.createTestingModule({ imports: [AgentRunModule] })
      .overrideProvider(AgentRunRepository)
      .useValue(repository)
      .compile();

    expect(module.get(AgentRunService)).toBeInstanceOf(AgentRunService);
  });

  it('adds the run with its counts, tokens, model calls and tool calls', async () => {
    await service.record(run);

    expect(repository.create).toHaveBeenCalledWith({
      requestId: 'req-1',
      conversationId: 'conv-1',
      userMessageId: 'msg-1',
      replyMessageId: null,
      outcome: 'failed',
      durationMs: 1500,
      firstTextMs: null,
      modelCallCount: 2,
      unfinishedModelCallCount: 1,
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 10,
      toolCallCount: 1,
      failedToolCallCount: 0,
      modelCalls: run.modelCalls,
      toolCalls: [toolCall],
    });
  });

  it('logs a failed write and never throws: the reply has been sent', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    repository.create.mockRejectedValue(new Error('db down'));

    await expect(service.record(run)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      'Agent run of conversation conv-1 was not saved',
      expect.stringContaining('db down'),
    );
  });
});
