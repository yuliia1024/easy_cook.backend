import { ModelMessage } from 'ai';
import { MessageRole } from '../../../common/constants';
import { MenuComposition } from '../../../common/types';
import { MessageWithMenu } from '../../data-access/conversation/conversation.repository';
import { toModelMenu } from './model-menu';

/** A saved message as the model reads it; the evals pass only the role and the text. */
export type ModelHistoryMessage = Pick<MessageWithMenu, 'role' | 'content'> &
  Partial<Pick<MessageWithMenu, 'menuVersionId' | 'menuVersion'>>;

/** The menu of the version the message suggested; a snapshot without days is not one. */
function suggestedMenu(message: ModelHistoryMessage): MenuComposition | null {
  const menu = message.menuVersion?.compositionSnapshot as Partial<MenuComposition> | undefined;
  return menu && Array.isArray(menu.days) ? (menu as MenuComposition) : null;
}

/**
 * Saved messages as the model reads them, in the same order: role and text, and the latest menu an
 * assistant reply suggested, compactly after its text (`toModelMenu`). Earlier menus stay out to
 * save tokens; a revision changes the latest one.
 */
export function toModelMessages(messages: ModelHistoryMessage[]): ModelMessage[] {
  const latestMenuIndex = messages
    .map((message) => message.role === MessageRole.Assistant && suggestedMenu(message) !== null)
    .lastIndexOf(true);
  return messages.map((message, index) => {
    const role = message.role === MessageRole.Assistant ? 'assistant' : 'user';
    const menu = index === latestMenuIndex ? suggestedMenu(message) : null;
    const modelMenu = menu && toModelMenu(menu, message.menuVersionId ?? null);
    return { role, content: modelMenu ? `${message.content}\n\n${modelMenu}` : message.content };
  });
}
