import { ModelMessage } from 'ai';
import {
  MessageRole,
  MODEL_PREFERENCE_CHANGE_MARKER,
  MODEL_WISH_OFFER_MARKER,
} from '../../../common/constants';
import { MenuComposition } from '../../../common/types';
import { estimateTokens } from '../../../common/utils';
import { MessageWithMenu } from '../../data-access/conversation/conversation.repository';
import { toModelMenu } from './model-menu';
import { pendingPreferenceChange } from './pending-preference-change';
import { pendingWishOffer } from './pending-wish-offer';

/** A saved message as the model reads it; the evals pass only the role and the text. */
export type ModelHistoryMessage = Pick<MessageWithMenu, 'role' | 'content'> &
  Partial<
    Pick<MessageWithMenu, 'menuVersionId' | 'menuVersion' | 'preferenceChange' | 'wishOffer'>
  >;

/** The menu of the version the message suggested; a snapshot without days is not one. */
function suggestedMenu(message: ModelHistoryMessage): MenuComposition | null {
  const menu = message.menuVersion?.compositionSnapshot as Partial<MenuComposition> | undefined;
  return menu && Array.isArray(menu.days) ? (menu as MenuComposition) : null;
}

/**
 * Saved messages as the model reads them, in the same order: role and text, the latest menu an
 * assistant reply suggested, compactly after its text (`toModelMenu`), and the preference change
 * waiting for the user's yes after the latest reply (`pendingPreferenceChange`). Earlier menus
 * stay out to save tokens; a revision changes the latest one.
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

/**
 * The text of each message as the model reads it: the latest suggested menu after its reply, and
 * the pending preference change after the latest reply (`MODEL_PREFERENCE_CHANGE_MARKER`) and its
 * pending wish offer (`MODEL_WISH_OFFER_MARKER`).
 */
function modelTexts(messages: ModelHistoryMessage[]): string[] {
  const isAssistant = messages.map(({ role }) => role === MessageRole.Assistant);
  const latestMenuIndex = messages
    .map((message, index) => isAssistant[index] && suggestedMenu(message) !== null)
    .lastIndexOf(true);
  const change = pendingPreferenceChange(messages);
  const offer = pendingWishOffer(messages);
  const latestReplyIndex = isAssistant.lastIndexOf(true);
  return messages.map((message, index) => {
    const menu = index === latestMenuIndex ? suggestedMenu(message) : null;
    const modelMenu = menu && toModelMenu(menu, message.menuVersionId ?? null);
    const parts = [message.content, modelMenu];
    if (change && index === latestReplyIndex) {
      parts.push(
        `${MODEL_PREFERENCE_CHANGE_MARKER} ${change.action} ${change.preferenceType}: ${change.value}`,
      );
    }
    if (offer && index === latestReplyIndex) {
      parts.push(
        `${MODEL_WISH_OFFER_MARKER} ${offer.wishes}: ${offer.recipes.map(({ name }) => name).join(', ')}`,
      );
    }
    return parts.filter(Boolean).join('\n\n');
  });
}
