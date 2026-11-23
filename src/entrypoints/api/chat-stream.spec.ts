import { UIMessageChunk } from 'ai';
import {
  ChatStatusStep,
  ChatStreamEventType,
  INTERNAL_ERROR_REPLY,
  MealType,
} from '../../common/constants';
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

  it('sends statuses and the pending menu as transient data parts around the text', async () => {
    await expect(
      read([
        { type: ChatStreamEventType.Status, step: ChatStatusStep.Thinking },
        {
          type: ChatStreamEventType.MenuPending,
          days: 2,
          mealTypes: [MealType.Breakfast, MealType.Lunch],
        },
        { type: ChatStreamEventType.Status, step: ChatStatusStep.CheckingConstraints },
        { type: ChatStreamEventType.TextDelta, content: 'Your menu' },
        { type: ChatStreamEventType.Done },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ type: 'start' }),
      {
        type: 'data-status',
        data: { step: 'thinking', message: 'Thinking' },
        transient: true,
      },
      {
        type: 'data-menu-pending',
        data: { days: 2, mealTypes: ['breakfast', 'lunch'] },
        transient: true,
      },
      {
        type: 'data-status',
        data: { step: 'checking_constraints', message: 'Checking the constraints' },
        transient: true,
      },
      { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: 'Your menu' },
      { type: 'text-end', id: 'text' },
      expect.objectContaining({ type: 'finish' }),
    ]);
  });

  it('opens a new text part for the text after a menu', async () => {
    const menu = {
      days: [],
      dailyAverage: { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
      issues: [],
    };
    await expect(
      read([
        { type: ChatStreamEventType.TextDelta, content: 'Your menu' },
        { type: ChatStreamEventType.MenuReady, menuId: 'm1', versionId: 'v1', menu },
        { type: ChatStreamEventType.TextDelta, content: 'Shall I save it?' },
        { type: ChatStreamEventType.Done },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ type: 'start' }),
      { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: 'Your menu' },
      { type: 'text-end', id: 'text' },
      { type: 'data-menu', data: { menuId: 'm1', versionId: 'v1', composition: menu } },
      { type: 'text-start', id: 'text-2' },
      { type: 'text-delta', id: 'text-2', delta: 'Shall I save it?' },
      { type: 'text-end', id: 'text-2' },
      expect.objectContaining({ type: 'finish' }),
    ]);
  });

  it('sends the menu the chat saved as data-menu-saved with its ids', async () => {
    await expect(
      read([
        { type: ChatStreamEventType.MenuSaved, menuId: 'm1', versionId: 'v1' },
        { type: ChatStreamEventType.TextDelta, content: 'Saved.' },
        { type: ChatStreamEventType.Done },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ type: 'start' }),
      { type: 'data-menu-saved', data: { menuId: 'm1', versionId: 'v1' } },
      { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: 'Saved.' },
      { type: 'text-end', id: 'text' },
      expect.objectContaining({ type: 'finish' }),
    ]);
  });

  it('sends a proposed and an applied preference change with the change', async () => {
    const change = { action: 'add', preferenceType: 'allergy', value: 'peanut' } as const;
    const chunks = await read([
      { type: ChatStreamEventType.PreferenceChangeProposed, change } as ChatStreamEvent,
      { type: ChatStreamEventType.PreferencesUpdated, change } as ChatStreamEvent,
      { type: ChatStreamEventType.Done },
    ]);

    expect(chunks.slice(1, 3)).toEqual([
      { type: 'data-preference-change', data: { change } },
      { type: 'data-preferences-updated', data: { change } },
    ]);
  });

  it('sends a wish offer with its recipes', async () => {
    const offer = {
      wishes: 'sushi',
      recipes: [{ id: 'r1', name: 'Salmon poke bowl', mealType: 'lunch' }],
    };
    const chunks = await read([
      { type: ChatStreamEventType.WishOfferProposed, offer } as ChatStreamEvent,
      { type: ChatStreamEventType.Done },
    ]);

    expect(chunks[1]).toEqual({ type: 'data-wish-offer', data: { offer } });
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

  it('sends a validated menu as a data part with the ids of its saved version', async () => {
    const menu = {
      days: [],
      dailyAverage: { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
      issues: [],
    };

    const chunks = await read([
      { type: ChatStreamEventType.MenuReady, menuId: 'm', versionId: 'v', menu },
      { type: ChatStreamEventType.Done },
    ]);

    expect(chunks).toContainEqual({
      type: 'data-menu',
      data: { menuId: 'm', versionId: 'v', composition: menu },
    });
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
