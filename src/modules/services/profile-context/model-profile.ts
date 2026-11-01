import { ModelMessage } from 'ai';
import { MODEL_NOT_SET } from '../../../common/constants';
import { MenuRequest } from '../../../common/contracts';
import { ModelProfile, ProfileContext } from '../../../common/types';

/** What the model knows of the conversation besides its latest messages. */
export interface ModelConversationContext {
  /** The menu request the chat gathered (`conversations.menu_request`). */
  menuRequest: MenuRequest | null;
  /** The older messages, summarized (`conversations.summary`). */
  summary: string | null;
}

export const EMPTY_CONVERSATION_CONTEXT: ModelConversationContext = {
  menuRequest: null,
  summary: null,
};

/**
 * The compact profile every model call gets: the goal, the daily target and the preferences.
 * Unknown values are `"not set"` (no profile, no goal yet), never `0` or an empty list.
 */
export function toModelProfile(context: ProfileContext | null): ModelProfile {
  if (!context) {
    return {
      goal: MODEL_NOT_SET,
      dailyTarget: MODEL_NOT_SET,
      diets: MODEL_NOT_SET,
      allergies: MODEL_NOT_SET,
      excludedIngredients: MODEL_NOT_SET,
      dislikedFoods: MODEL_NOT_SET,
    };
  }
  const { goal, nutritionGoal, rules } = context;
  return {
    goal,
    dailyTarget: nutritionGoal
      ? {
          kcal: Math.round(nutritionGoal.caloriesKcal),
          proteinG: Math.round(nutritionGoal.proteinG),
          fatG: Math.round(nutritionGoal.fatG),
          carbsG: Math.round(nutritionGoal.carbsG),
        }
      : MODEL_NOT_SET,
    diets: rules.diets,
    allergies: rules.allergies,
    excludedIngredients: rules.excludedIngredients,
    dislikedFoods: rules.dislikedFoods,
  };
}

/**
 * The profile as the first message before the conversation: user data stays out of the
 * instructions, which explain the message. The menu request and the summary of the conversation
 * come with it, each only when there is one; the menu details are never left to the summary.
 */
export function profileMessage(
  context: ProfileContext | null,
  { menuRequest, summary }: ModelConversationContext = EMPTY_CONVERSATION_CONTEXT,
): ModelMessage {
  return {
    role: 'user',
    content: JSON.stringify({
      profile: toModelProfile(context),
      ...(menuRequest && { menuRequest }),
      ...(summary && { earlierConversation: summary }),
    }),
  };
}
