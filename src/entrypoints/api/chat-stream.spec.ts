import { UIMessageChunk } from 'ai';
import { ChatStreamEventType, INTERNAL_ERROR_REPLY } from '../../common/constants';
import { ChatStreamEvent } from '../../common/types';
import { toChatStream } from './chat-stream';

const read = async (events: ChatStreamEvent[] | AsyncIterable<ChatStreamEvent>) => {
  const source =
    Symbol.asyncIterator in events
      ? events
      : (async function* () {
          yield* events;
        })();
  const chunks: UIMessageChunk[] = [];
  for await (const chunk of toChatStream(source) as unknown as AsyncIterable<UIMessageChunk>) {
    chunks.push(chunk);
  }
  return chunks;
};

describe('toChatStream', () => {
  it('streams text deltas as one text part and finishes on done', async () => {
    await expect(
      read([
        { type: ChatStreamEventType.TextDelta, content: 'Day 1: ' },
        { type: ChatStreamEventType.TextDelta, content: 'oatmeal' },
        { type: ChatStreamEventType.Done },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ type: 'start' }),
      { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: 'Day 1: ' },
      { type: 'text-delta', id: 'text', delta: 'oatmeal' },
      { type: 'text-end', id: 'text' },
      expect.objectContaining({ type: 'finish' }),
    ]);
  });

  it('sends a clarification as text plus the missing fields', async () => {
    const chunks = await read([
      {
        type: ChatStreamEventType.Clarification,
        message: 'How many days?',
        missingFields: ['days'],
      },
      { type: ChatStreamEventType.Done },
    ]);

    expect(chunks).toContainEqual({ type: 'text-delta', id: 'text', delta: 'How many days?' });
    expect(chunks).toContainEqual({
      type: 'data-clarification',
      data: { missingFields: ['days'] },
    });
  });

  it('sends a validated menu as a data part', async () => {
    const menu = {
      days: [],
      dailyAverage: { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
      issues: [],
    };

    const chunks = await read([
      { type: ChatStreamEventType.MenuReady, menu },
      { type: ChatStreamEventType.Done },
    ]);

    expect(chunks).toContainEqual({ type: 'data-menu', data: menu });
  });

  it('ends with the error code and its safe message', async () => {
    const chunks = await read([
      { type: ChatStreamEventType.TextDelta, content: 'Day 1' },
      {
        type: ChatStreamEventType.Error,
        code: 'assistant_unavailable',
        message: 'Try later',
        retryable: true,
      },
      { type: ChatStreamEventType.Done },
    ]);

    expect(chunks.slice(-3)).toEqual([
      { type: 'text-end', id: 'text' },
      {
        type: 'data-error',
        data: { code: 'assistant_unavailable', message: 'Try later', retryable: true },
        transient: true,
      },
      { type: 'error', errorText: 'Try later' },
    ]);
  });

  it('hides an unexpected failure behind a generic message', async () => {
    const chunks = await read(
      (async function* (): AsyncGenerator<ChatStreamEvent> {
        yield { type: ChatStreamEventType.TextDelta, content: 'Day 1' };
        throw new Error('secret internals');
      })(),
    );

    expect(chunks.at(-1)).toEqual({ type: 'error', errorText: INTERNAL_ERROR_REPLY });
  });
});
