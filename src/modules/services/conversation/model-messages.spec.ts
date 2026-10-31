import { MessageRole } from '../../../common/constants';
import { buildMenuVersion, buildMessage, MENU_VERSION_ID } from '../../../test/fixtures';
import { toModelMenu } from './model-menu';
import { toModelMessages } from './model-messages';

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
