import { ChatTraceOutcome, ChatTraceStep } from '../../../common/constants';
import { ModelCallRecord } from '../../../common/types';
import { ChatTrace, ChatReplySummary, describeSummary } from './chat-trace';

const modelCall = (overrides: Partial<ModelCallRecord> = {}): ModelCallRecord => ({
  prompt: 'chat@v1',
  provider: 'openai',
  modelId: 'gpt-test',
  step: 1,
  durationMs: 100,
  usage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 10 },
  finishReason: 'stop',
  ...overrides,
});

describe('ChatTrace', () => {
  it('records the steps in order with the time since the message came in', () => {
    const trace = new ChatTrace(true, 'conv-1', 'Hi');

    trace.add(ChatTraceStep.Intent, { intent: 'general_chat' });
    trace.add(ChatTraceStep.Saved, { content: 'Hello' });

    expect(trace.toRecord(ChatTraceOutcome.Replied)).toEqual({
      conversationId: 'conv-1',
      request: { content: 'Hi' },
      outcome: ChatTraceOutcome.Replied,
      durationMs: expect.any(Number),
      summary: expect.objectContaining({ outcome: ChatTraceOutcome.Replied }),
      modelCalls: [],
      steps: [
        { step: ChatTraceStep.Intent, atMs: expect.any(Number), data: { intent: 'general_chat' } },
        { step: ChatTraceStep.Saved, atMs: expect.any(Number), data: { content: 'Hello' } },
      ],
    });
  });

  it('keeps an error as plain data with its stack', () => {
    const trace = new ChatTrace(true, 'conv-1', 'Hi');

    trace.addError(new TypeError('bad'));
    trace.addError('just text');

    expect(trace.toRecord(ChatTraceOutcome.Failed).steps.map(({ data }) => data)).toEqual([
      { name: 'TypeError', message: 'bad', stack: expect.stringContaining('TypeError: bad') },
      { message: 'just text' },
    ]);
  });

  it('records nothing when disabled', () => {
    const trace = new ChatTrace(false, 'conv-1', 'Hi');

    trace.add(ChatTraceStep.Intent, {});
    trace.addError(new Error('x'));

    expect(trace.toRecord(ChatTraceOutcome.Replied).steps).toEqual([]);
  });

  it('keeps the time of the first text only', async () => {
    const trace = new ChatTrace(false, 'conv-1', 'Hi');

    expect(trace.summarize(ChatTraceOutcome.Replied, []).firstTextMs).toBeNull();
    trace.textSent();
    const first = trace.summarize(ChatTraceOutcome.Replied, []).firstTextMs;
    await new Promise((resolve) => setTimeout(resolve, 5));
    trace.textSent();

    expect(first).toEqual(expect.any(Number));
    expect(trace.summarize(ChatTraceOutcome.Replied, []).firstTextMs).toBe(first);
  });

  it('counts the tool calls even when disabled, and traces them when enabled', () => {
    const call = {
      toolCallId: 'call_1',
      name: 'search_recipes',
      input: {},
      output: {},
      error: null,
      durationMs: 3,
    };
    const disabled = new ChatTrace(false, 'conv-1', 'Hi');
    const enabled = new ChatTrace(true, 'conv-1', 'Hi');

    [disabled, enabled].forEach((trace) => {
      trace.addToolCall(call);
      trace.addToolCall({ ...call, error: 'not_found' as never });
    });

    expect(disabled.summarize(ChatTraceOutcome.Replied, [])).toMatchObject({
      toolCalls: 2,
      failedToolCalls: 1,
    });
    expect(disabled.toRecord(ChatTraceOutcome.Replied).steps).toEqual([]);
    expect(enabled.toRecord(ChatTraceOutcome.Replied).steps.map(({ step }) => step)).toEqual([
      ChatTraceStep.ToolCall,
      ChatTraceStep.ToolCall,
    ]);
  });

  it('sums the tokens of every model call and counts the unfinished ones apart', () => {
    const trace = new ChatTrace(true, 'conv-1', 'Hi');
    const calls = [
      modelCall({ prompt: 'intent@v1' }),
      modelCall({ step: 1, finishReason: 'tool-calls' }),
      modelCall({ step: 2 }),
      modelCall({ step: 3, usage: null, finishReason: 'aborted' }),
    ];

    const record = trace.toRecord(ChatTraceOutcome.Aborted, calls);

    expect(record.summary).toEqual({
      outcome: ChatTraceOutcome.Aborted,
      durationMs: expect.any(Number),
      firstTextMs: null,
      modelCalls: 4,
      unfinishedModelCalls: 1,
      usage: { inputTokens: 300, cachedInputTokens: 60, outputTokens: 30 },
      toolCalls: 0,
      failedToolCalls: 0,
    });
    expect(record.modelCalls).toEqual(calls);
  });
});

describe('describeSummary', () => {
  const summary: ChatReplySummary = {
    outcome: ChatTraceOutcome.Replied,
    durationMs: 5230,
    firstTextMs: 1200,
    modelCalls: 4,
    unfinishedModelCalls: 0,
    usage: { inputTokens: 5400, cachedInputTokens: 1200, outputTokens: 320 },
    toolCalls: 2,
    failedToolCalls: 0,
  };

  it('puts the time, first text, model calls, tokens and tool calls in one line', () => {
    expect(describeSummary(summary)).toBe(
      'Chat reply replied in 5230ms, first text after 1200ms: 4 model calls, ' +
        'tokens 5400 in (1200 cached) + 320 out; 2 tool calls',
    );
  });

  it('names the unfinished model calls, the failed tools and a reply without text', () => {
    expect(
      describeSummary({
        ...summary,
        firstTextMs: null,
        unfinishedModelCalls: 1,
        failedToolCalls: 1,
      }),
    ).toBe(
      'Chat reply replied in 5230ms, no text: 4 model calls (1 unfinished), ' +
        'tokens 5400 in (1200 cached) + 320 out; 2 tool calls (1 failed)',
    );
  });
});
