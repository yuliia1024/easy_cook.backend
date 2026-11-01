import { ModelMessage } from 'ai';
import { MessageRole } from '../../../common/constants';
import { MenuComposition } from '../../../common/types';
import { estimateTokens } from '../../../common/utils';
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
  const texts = modelTexts(messages);
  return messages.map((message, index) => ({
    role: message.role === MessageRole.Assistant ? 'assistant' : 'user',
    content: texts[index],
  }));
}

/** The estimated tokens of the messages as the model reads them (`toModelMessages`). */
export function historyTokens(messages: ModelHistoryMessage[]): number {
  return modelTexts(messages).reduce((sum, text) => sum + estimateTokens(text), 0);
}

/**
 * The latest messages whose text, as the model reads it, fits `maxTokens`, oldest first. The
 * newest message is always kept: it is the one to answer. The latest menu counts where it is
 * shown, and a cut-off history shows it only when its reply is kept.
 */
export function fitHistory<T extends ModelHistoryMessage>(messages: T[], maxTokens: number): T[] {
  const tokens = modelTexts(messages).map(estimateTokens);
  let start = messages.length;
  let total = 0;
  while (start > 0) {
    const next = total + tokens[start - 1];
    if (next > maxTokens && start < messages.length) {
      break;
    }
    total = next;
    start -= 1;
  }
  return messages.slice(start);
}

/** The text of each message as the model reads it: the latest suggested menu after its reply. */
function modelTexts(messages: ModelHistoryMessage[]): string[] {
  const latestMenuIndex = messages
    .map((message) => message.role === MessageRole.Assistant && suggestedMenu(message) !== null)
    .lastIndexOf(true);
  return messages.map((message, index) => {
    const menu = index === latestMenuIndex ? suggestedMenu(message) : null;
    const modelMenu = menu && toModelMenu(menu, message.menuVersionId ?? null);
    return modelMenu ? `${message.content}\n\n${modelMenu}` : message.content;
  });
}
