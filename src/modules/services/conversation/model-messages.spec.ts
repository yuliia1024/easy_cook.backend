import { MessageRole } from '../../../common/constants';
import { buildMenuVersion, buildMessage, MENU_VERSION_ID } from '../../../test/fixtures';
import { toModelMenu } from './model-menu';
import { estimateTokens } from '../../../common/utils';
import { fitHistory, historyTokens, toModelMessages } from './model-messages';

describe('toModelMessages', () => {
  const composition = buildMenuVersion().compositionSnapshot;
  const modelMenu = toModelMenu(composition as never, MENU_VERSION_ID);

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

  it('adds only the latest suggested menu after the text of its reply', () => {
    const earlier = { ...(composition as object), days: [] };
    expect(
      toModelMessages([
        buildMessage({ content: 'A menu for a day' }),
        buildMessage({
          role: MessageRole.Assistant,
          content: 'Here is a menu',
          suggestedMenu: composition,
          menuVersionId: 'old-version',
        }),
        buildMessage({ content: 'Another lunch' }),
        buildMessage({
          role: MessageRole.Assistant,
          content: 'Here is a new one',
          suggestedMenu: composition,
          menuVersionId: MENU_VERSION_ID,
        }),
        buildMessage({ role: MessageRole.Assistant, content: 'Anything else?' }),
        buildMessage({ content: 'No mushrooms', suggestedMenu: earlier }),
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

  it('ignores a stored menu without days', () => {
    expect(
      toModelMessages([
        buildMessage({ role: MessageRole.Assistant, content: 'Hello', suggestedMenu: { days: 1 } }),
      ]),
    ).toEqual([{ role: 'assistant', content: 'Hello' }]);
  });

  it('adds a menu without a version id', () => {
    expect(
      toModelMessages([
        { role: MessageRole.Assistant, content: 'Menu', suggestedMenu: composition },
      ])[0].content,
    ).toBe(`Menu\n\n${toModelMenu(composition as never, null)}`);
  });
});

describe('historyTokens', () => {
  it('counts the text of every message and the latest menu where it is shown', () => {
    const composition = buildMenuVersion().compositionSnapshot;
    const reply = buildMessage({
      role: MessageRole.Assistant,
      content: 'Here is a menu',
      suggestedMenu: composition,
      menuVersionId: MENU_VERSION_ID,
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
