export enum MessageRole {
  User = 'user',
  Assistant = 'assistant',
}

export enum Intent {
  GeneralChat = 'general_chat',
  GenerateMenu = 'generate_menu',
  Clarification = 'clarification',
  OutOfScope = 'out_of_scope',
}

export enum ChatErrorCode {
  AssistantUnavailable = 'assistant_unavailable',
  InternalError = 'internal_error',
}

export const CONVERSATION_TITLE_MAX_LENGTH = 255;
export const MESSAGE_MAX_LENGTH = 300;
/** Latest messages the general chat sees, the new one included. */
export const GENERAL_CHAT_HISTORY_LIMIT = 10;
/** A new conversation is titled after the first message, cut to this length. */
export const AUTO_TITLE_LENGTH = 60;
export const DEFAULT_CONVERSATION_TITLE = 'New conversation';

/** Fixed replies: these intents are answered without another model call. */
export const OUT_OF_SCOPE_REPLY =
  'I can only help with meal planning: menus, recipes and your dietary preferences.';
export const CLARIFICATION_REPLY =
  'Could you tell me a bit more? For example, how many days the menu should cover and which meals to include.';
export const CLARIFICATION_MISSING_FIELDS = ['days', 'meals'];
export const MENU_PLANNER_STUB_REPLY =
  'Menu generation is not available yet. Meanwhile, I can talk through meal ideas with you.';
/** Sent instead of the error itself, which never reaches the client. */
export const ASSISTANT_UNAVAILABLE_REPLY =
  'The assistant is unavailable right now. Please try again in a moment.';
export const INTERNAL_ERROR_REPLY = 'Something went wrong while answering. Please try again.';
