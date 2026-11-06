import { ChatTraceOutcome, ChatTraceStep } from '../../../common/constants';
import { ChatTrace } from './chat-trace';

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
});
