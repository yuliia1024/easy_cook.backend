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
  Status = 'status',
  MenuPending = 'menu_pending',
  MenuReady = 'menu_ready',
  Clarification = 'clarification',
  Error = 'error',
  Done = 'done',
}

/** The step of a reply the client shows while it waits; never saved. */
export enum ChatStatusStep {
  Thinking = 'thinking',
  SearchingBreakfasts = 'searching_breakfasts',
  PickingLunches = 'picking_lunches',
  CheckingConstraints = 'checking_constraints',
}

export const CHAT_STATUS_MESSAGES: Record<ChatStatusStep, string> = {
  [ChatStatusStep.Thinking]: 'Thinking',
  [ChatStatusStep.SearchingBreakfasts]: 'Looking for breakfasts',
  [ChatStatusStep.PickingLunches]: 'Picking lunches',
  [ChatStatusStep.CheckingConstraints]: 'Checking the constraints',
};

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
/** The menu request fields a menu cannot be planned without; the rest has defaults or is optional. */
export const MENU_REQUEST_REQUIRED_FIELDS = ['days', 'mealTypes'] as const;
/** Offers the nearest number of days a menu can have instead of the one the user asked for. */
export const daysOutOfRangeReply = (requested: number, offered: number): string =>
  requested > offered
    ? `I can plan a menu for up to ${offered} days, not ${requested}. Shall I make a ${offered}-day menu?`
    : `A menu needs at least ${offered} day. Shall I make a ${offered}-day menu?`;
export const NO_MENU_RECIPES_REPLY =
  'I could not find recipes that fit your preferences for breakfast, lunch, a snack and dinner. Add more recipes or adjust your preferences and try again.';
/** Sent when every attempt of the planner gave a menu that breaks the rules. */
export const MENU_PLAN_FAILED_REPLY =
  'Sorry, I could not put together a menu that fits your request and preferences. Please try again or change the request.';
export const NO_PROFILE_REPLY =
  'Please fill in your profile first, so I can plan a menu for your goal and preferences.';
/** Sent instead of the error itself, which never reaches the client. */
export const ASSISTANT_UNAVAILABLE_REPLY =
  'The assistant is unavailable right now. Please try again in a moment.';
export const ASSISTANT_INVALID_OUTPUT_REPLY = "Sorry, I couldn't process that. Please try again.";
export const INTERNAL_ERROR_REPLY = 'Something went wrong while answering. Please try again.';
