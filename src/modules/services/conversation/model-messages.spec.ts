import { MessageRole } from '../../../common/constants';
import { buildMenuVersion, buildMessage, MENU_ID, MENU_VERSION_ID } from '../../../test/fixtures';
import { toModelMenu } from './model-menu';
import { estimateTokens } from '../../../common/utils';
import { fitHistory, historyTokens, toModelMessages } from './model-messages';

describe('toModelMessages', () => {
  const composition = buildMenuVersion().compositionSnapshot;
  const modelMenu = toModelMenu(composition as never, MENU_VERSION_ID);
  const version = (compositionSnapshot: unknown = composition) =>
    ({ menuId: MENU_ID, compositionSnapshot }) as never;

  it('keeps the order and passes only the role and the text', () => {
    expect(
      toModelMessages([
        buildMessage({ content: 'Hi' }),
        buildMessage({ role: MessageRole.Assistant, content: 'Hello' }),
      ]),
    ).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ]);
  });

  it('adds only the latest menu an assistant reply suggested, from its version', () => {
    expect(
      toModelMessages([
        buildMessage({ content: 'A menu for a day' }),
        buildMessage({
          role: MessageRole.Assistant,
          content: 'Here is a menu',
          menuVersionId: 'old-version',
          menuVersion: version(),
        }),
        buildMessage({ content: 'Another lunch' }),
        buildMessage({
          role: MessageRole.Assistant,
          content: 'Here is a new one',
          menuVersionId: MENU_VERSION_ID,
          menuVersion: version(),
        }),
        buildMessage({ role: MessageRole.Assistant, content: 'Anything else?' }),
        buildMessage({ content: 'No mushrooms', menuVersion: version() }),
      ]),
    ).toEqual([
      { role: 'user', content: 'A menu for a day' },
      { role: 'assistant', content: 'Here is a menu' },
      { role: 'user', content: 'Another lunch' },
      { role: 'assistant', content: `Here is a new one\n\n${modelMenu}` },
      { role: 'assistant', content: 'Anything else?' },
      { role: 'user', content: 'No mushrooms' },
    ]);
  });

  it('ignores a version snapshot without days', () => {
    expect(
      toModelMessages([
        buildMessage({
          role: MessageRole.Assistant,
          content: 'Hello',
          menuVersionId: MENU_VERSION_ID,
          menuVersion: version({ days: 1 }),
        }),
      ]),
    ).toEqual([{ role: 'assistant', content: 'Hello' }]);
  });

  it('adds the preference change the latest reply proposed after its text', () => {
    const change = { action: 'add', preferenceType: 'allergy', value: 'peanut' };
    expect(
      toModelMessages([
        buildMessage({ content: "I'm allergic to peanuts" }),
        buildMessage({
          role: MessageRole.Assistant,
          content: 'Add a peanut allergy?',
          preferenceChange: change,
        }),
        buildMessage({ content: 'Yes' }),
      ]),
    ).toEqual([
      { role: 'user', content: "I'm allergic to peanuts" },
      {
        role: 'assistant',
        content: 'Add a peanut allergy?\n\n[preference change] add allergy: peanut',
      },
      { role: 'user', content: 'Yes' },
    ]);
  });

  it('leaves out a change a later reply ended, and an invalid one', () => {
    const change = { action: 'add', preferenceType: 'allergy', value: 'peanut' };
    expect(
      toModelMessages([
        buildMessage({ role: MessageRole.Assistant, content: 'Add it?', preferenceChange: change }),
        buildMessage({ role: MessageRole.Assistant, content: 'Anything else?' }),
      ]),
    ).toEqual([
      { role: 'assistant', content: 'Add it?' },
      { role: 'assistant', content: 'Anything else?' },
    ]);
    expect(
      toModelMessages([
        buildMessage({
          role: MessageRole.Assistant,
          content: 'Add it?',
          preferenceChange: { action: 'add' },
        }),
      ]),
    ).toEqual([{ role: 'assistant', content: 'Add it?' }]);
  });

  it('passes a reply whose version was deleted as text only', () => {
    expect(
      toModelMessages([{ role: MessageRole.Assistant, content: 'Menu', menuVersion: null }]),
    ).toEqual([{ role: 'assistant', content: 'Menu' }]);
  });
});

describe('historyTokens', () => {
  it('counts the text of every message and the latest menu where it is shown', () => {
    const composition = buildMenuVersion().compositionSnapshot;
    const reply = buildMessage({
      role: MessageRole.Assistant,
      content: 'Here is a menu',
      menuVersionId: MENU_VERSION_ID,
      menuVersion: { menuId: MENU_ID, compositionSnapshot: composition },
    });
    const shown = `Here is a menu\n\n${toModelMenu(composition as never, MENU_VERSION_ID)}`;

    expect(historyTokens([])).toBe(0);
    expect(historyTokens([buildMessage({ content: 'abcdef' }), reply])).toBe(
      estimateTokens('abcdef') + estimateTokens(shown),
    );
  });
});

describe('fitHistory', () => {
  const message = (index: number, length = 30): ReturnType<typeof buildMessage> =>
    buildMessage({ id: `message-${index}`, content: 'a'.repeat(length) });

  it('keeps the latest messages that fit the budget, oldest first', () => {
    const messages = [message(0), message(1), message(2), message(3)];

    expect(fitHistory(messages, 25)).toEqual([messages[2], messages[3]]);
    expect(fitHistory(messages, 40)).toEqual(messages);
    expect(fitHistory([], 40)).toEqual([]);
  });

  it('keeps the newest message even when it alone is over the budget', () => {
    const messages = [message(0), message(1, 300)];

    expect(fitHistory(messages, 10)).toEqual([messages[1]]);
  });

  it('does not skip a message to fit an older one', () => {
    const messages = [message(0, 3), message(1, 300), message(2, 3)];

    expect(fitHistory(messages, 50)).toEqual([messages[2]]);
  });
});
