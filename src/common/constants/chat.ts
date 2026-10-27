export enum MessageRole {
  User = 'user',
  Assistant = 'assistant',
}

export enum Intent {
  GeneralChat = 'general_chat',
  GenerateMenu = 'generate_menu',
  ReviseMenu = 'revise_menu',
  Clarification = 'clarification',
  OutOfScope = 'out_of_scope',
}

/** The part of the latest menu a `revise_menu` request changes. */
export enum MenuTargetScope {
  Menu = 'menu',
  Day = 'day',
  Meal = 'meal',
}

export enum ChatResponseType {
  Text = 'text',
  MenuReady = 'menu_ready',
  Clarification = 'clarification',
  Error = 'error',
}

export enum ChatStreamEventType {
  TextDelta = 'text_delta',
  MenuReady = 'menu_ready',
  Clarification = 'clarification',
  Error = 'error',
  Done = 'done',
}

export enum ChatErrorCode {
  AssistantUnavailable = 'assistant_unavailable',
  AssistantInvalidOutput = 'assistant_invalid_output',
  InternalError = 'internal_error',
}

export const CONVERSATION_TITLE_MAX_LENGTH = 255;
export const MESSAGE_MAX_LENGTH = 300;
/** Latest messages the general chat sees, the new one included. */
export const GENERAL_CHAT_HISTORY_LIMIT = 10;
/** Latest messages the intent classifier sees, the new one included. */
export const INTENT_HISTORY_LIMIT = 6;
/** A new conversation is titled after the first message, cut to this length. */
export const AUTO_TITLE_LENGTH = 60;
export const DEFAULT_CONVERSATION_TITLE = 'New conversation';

/** Fixed replies: these intents are answered without another model call. */
export const OUT_OF_SCOPE_REPLY =
  'I can only help with meal planning: menus, recipes and your dietary preferences.';
export const CLARIFICATION_REPLY =
  'Could you tell me a bit more? For example, how many days the menu should cover and which meals to include.';
export const CLARIFICATION_MISSING_FIELDS = ['days', 'meals'];
export const NO_MENU_RECIPES_REPLY =
  'I could not find recipes that fit your preferences for breakfast, lunch and dinner. Add more recipes or adjust your preferences and try again.';
export const NO_PROFILE_REPLY =
  'Please fill in your profile first, so I can plan a menu for your goal and preferences.';
/** Sent instead of the error itself, which never reaches the client. */
export const ASSISTANT_UNAVAILABLE_REPLY =
  'The assistant is unavailable right now. Please try again in a moment.';
export const ASSISTANT_INVALID_OUTPUT_REPLY = "Sorry, I couldn't process that. Please try again.";
export const INTERNAL_ERROR_REPLY = 'Something went wrong while answering. Please try again.';
