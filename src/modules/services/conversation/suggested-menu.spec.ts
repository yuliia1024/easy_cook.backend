import { MessageRole } from '../../../common/constants';
import { latestSuggestedVersion } from './suggested-menu';

const message = (
  role: MessageRole,
  menuVersionId: string | null = null,
  menuId = 'menu-1',
): Parameters<typeof latestSuggestedVersion>[0][number] => ({
  role,
  menuVersionId,
  menuVersion: menuVersionId ? { menuId, compositionSnapshot: {} } : null,
});

describe('latestSuggestedVersion', () => {
  it('is the version of the latest assistant reply that suggested a menu', () => {
    expect(
      latestSuggestedVersion([
        message(MessageRole.User),
        message(MessageRole.Assistant, 'v1'),
        message(MessageRole.User),
        message(MessageRole.Assistant, 'v2', 'menu-2'),
        message(MessageRole.User),
        message(MessageRole.Assistant),
      ]),
    ).toEqual({ menuId: 'menu-2', versionId: 'v2' });
  });

  it('is null without a suggested menu', () => {
    expect(latestSuggestedVersion([])).toBeNull();
    expect(
      latestSuggestedVersion([message(MessageRole.User), message(MessageRole.Assistant)]),
    ).toBeNull();
  });

  it('skips a reply whose version is gone', () => {
    expect(
      latestSuggestedVersion([
        message(MessageRole.Assistant, 'v1'),
        { role: MessageRole.Assistant, menuVersionId: 'v2', menuVersion: null },
      ]),
    ).toEqual({ menuId: 'menu-1', versionId: 'v1' });
  });
});
