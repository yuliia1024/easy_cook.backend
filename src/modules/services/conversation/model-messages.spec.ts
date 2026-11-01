import { MessageRole } from '../../../common/constants';
import { buildMenuVersion, buildMessage, MENU_ID, MENU_VERSION_ID } from '../../../test/fixtures';
import { toModelMenu } from './model-menu';
import { toModelMessages } from './model-messages';

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

  it('passes a reply whose version was deleted as text only', () => {
    expect(
      toModelMessages([{ role: MessageRole.Assistant, content: 'Menu', menuVersion: null }]),
    ).toEqual([{ role: 'assistant', content: 'Menu' }]);
  });
});
