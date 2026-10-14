export enum MessageRole {
  User = 'user',
  Assistant = 'assistant',
}

export const CONVERSATION_TITLE_MAX_LENGTH = 255;
export const MESSAGE_MAX_LENGTH = 4000;
/** Latest messages the assistant sees. */
export const ASSISTANT_HISTORY_LIMIT = 20;
/** A new conversation is titled after the first message, cut to this length. */
export const AUTO_TITLE_LENGTH = 60;
export const DEFAULT_CONVERSATION_TITLE = 'New conversation';
