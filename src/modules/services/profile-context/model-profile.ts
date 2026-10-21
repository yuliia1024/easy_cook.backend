import { ModelMessage } from 'ai';
import { MODEL_NOT_SET } from '../../../common/constants';
import { ModelProfile, ProfileContext } from '../../../common/types';

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
 * instructions, which explain the message.
 */
export function profileMessage(context: ProfileContext | null): ModelMessage {
  return { role: 'user', content: JSON.stringify({ profile: toModelProfile(context) }) };
}
