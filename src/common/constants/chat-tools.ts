import { ChatStatusStep } from './chat';

export enum ChatToolName {
  SearchRecipes = 'search_recipes',
  GetRecipeDetails = 'get_recipe_details',
  GetFoodNutrition = 'get_food_nutrition',
  CalculateNutrition = 'calculate_nutrition',
  PlanMenu = 'plan_menu',
  ReviseMenu = 'revise_menu',
  SaveMenu = 'save_menu',
  ProposePreferenceChange = 'propose_preference_change',
  ApplyPreferenceChange = 'apply_preference_change',
}

/**
 * What a chat tool may do. `read` runs inside the model's loop and returns data to it; `write`
 * runs there too but has an effect besides its result (it changes data through a service, or
 * proposes a change the reply carries), at most once per reply, and may stream an event to the
 * client; `service_call` only records the call: the loop ends and the backend runs it
 * on its own path.
 */
export enum ChatToolOperation {
  Read = 'read',
  Write = 'write',
  ServiceCall = 'service_call',
}

/**
 * The step the client shows while a tool runs. The menu tools have none: the planner they hand
 * over to reports its own steps.
 */
export const CHAT_TOOL_STATUS: Readonly<Partial<Record<ChatToolName, ChatStatusStep>>> = {
  [ChatToolName.SearchRecipes]: ChatStatusStep.SearchingRecipes,
  [ChatToolName.GetRecipeDetails]: ChatStatusStep.ReadingRecipe,
  [ChatToolName.GetFoodNutrition]: ChatStatusStep.CheckingNutrition,
  [ChatToolName.CalculateNutrition]: ChatStatusStep.CalculatingNutrition,
  [ChatToolName.SaveMenu]: ChatStatusStep.SavingMenu,
  [ChatToolName.ApplyPreferenceChange]: ChatStatusStep.UpdatingPreferences,
};

/** What the model learns about a tool call that failed; it may call the tool again. */
export enum ChatToolErrorCode {
  InvalidArguments = 'invalid_arguments',
  NotFound = 'not_found',
  Rejected = 'rejected',
  Failed = 'failed',
}

/**
 * Model calls of one chat reply with tools. The last one may not call a tool, so the reply always
 * ends with text, unless a `service_call` tool ended it earlier.
 */
export const CHAT_TOOL_MAX_STEPS = 5;
/**
 * The most of a recipe's description or instructions a tool result carries (about 1000 tokens):
 * enough to answer about the recipe, without a long text filling the model's context.
 */
export const CHAT_TOOL_TEXT_MAX_LENGTH = 4000;
/** What `save_menu` tells the model; the menu is the latest one the chat suggested. */
export enum SaveMenuStatus {
  Saved = 'saved',
  AlreadySaved = 'already_saved',
}
export const CHAT_TOOL_FAILED_MESSAGE = 'The tool failed. Answer without it.';
export const CHAT_TOOL_SERVICE_CALL_MESSAGE =
  'Accepted: the app runs it and shows the user the result.';

export const CHAT_TOOL_QUERY_MAX_LENGTH = 100;
/** A request to `search_recipes` in the user's words is longer than a name. */
export const SEARCH_RECIPES_QUERY_MAX_LENGTH = 200;
export const SEARCH_RECIPES_MAX_RESULTS = 10;
export const SEARCH_RECIPES_DEFAULT_RESULTS = 5;
/** The closest recipes `search_recipes` offers when none fits the query. */
export const SEARCH_RECIPES_SIMILAR_MAX = 3;
/** Recipes read to filter by calories (not held per serving) or time when listing without a query. */
export const SEARCH_RECIPES_SCAN_LIMIT = 100;
export const FOOD_NUTRITION_MAX_RESULTS = 5;
export const CHAT_TOOL_MAX_QUANTITY_G = 5000;
export const CALCULATE_NUTRITION_MAX_ITEMS = 20;
export const CALCULATE_NUTRITION_MAX_SERVINGS = 20;
