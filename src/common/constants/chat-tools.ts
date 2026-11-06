import { ChatStatusStep } from './chat';

export enum ChatToolName {
  SearchRecipes = 'search_recipes',
  GetRecipeDetails = 'get_recipe_details',
  GetFoodNutrition = 'get_food_nutrition',
  CalculateNutrition = 'calculate_nutrition',
  PlanMenu = 'plan_menu',
  ReviseMenu = 'revise_menu',
}

/**
 * What a chat tool may do. `read` runs inside the model's loop and returns data to it;
 * `service_call` only records the call: the loop ends and the backend runs it on its own path.
 */
export enum ChatToolOperation {
  Read = 'read',
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
export const CHAT_TOOL_FAILED_MESSAGE = 'The tool failed. Answer without it.';
export const CHAT_TOOL_SERVICE_CALL_MESSAGE =
  'Accepted: the app runs it and shows the user the result.';

export const CHAT_TOOL_QUERY_MAX_LENGTH = 100;
export const SEARCH_RECIPES_MAX_RESULTS = 10;
export const SEARCH_RECIPES_DEFAULT_RESULTS = 5;
/** Recipes read to filter by calories, which the database does not hold per serving. */
export const SEARCH_RECIPES_SCAN_LIMIT = 100;
export const FOOD_NUTRITION_MAX_RESULTS = 5;
export const CHAT_TOOL_MAX_QUANTITY_G = 5000;
export const CALCULATE_NUTRITION_MAX_ITEMS = 20;
export const CALCULATE_NUTRITION_MAX_SERVINGS = 20;
