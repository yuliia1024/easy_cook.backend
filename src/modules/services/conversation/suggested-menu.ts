import { MessageRole } from '../../../common/constants';
import { MessageWithMenu } from '../../data-access/conversation/conversation.repository';
import { SavedMenuVersion } from '../menu/menu.service';

/**
 * The latest menu version an assistant reply of the conversation suggested: the one a revision
 * changes and `save_menu` confirms. Null when no reply suggested one or its version is gone. Pure.
 */
export function latestSuggestedVersion(
  messages: Array<Pick<MessageWithMenu, 'role' | 'menuVersionId' | 'menuVersion'>>,
): SavedMenuVersion | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const { role, menuVersionId, menuVersion } = messages[index];
    if (role === MessageRole.Assistant && menuVersionId && menuVersion) {
      return { menuId: menuVersion.menuId, versionId: menuVersionId };
    }
  }
  return null;
}
