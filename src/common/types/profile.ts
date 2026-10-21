import { Goal, MODEL_NOT_SET } from '../constants';
import { MacroValues, NutritionGoalSnapshot, PreferenceRules } from './menu';

/** The profile as the model and the menu checks read it: goal, daily targets and preferences. */
export interface ProfileContext {
  profileId: string;
  goal: Goal;
  /** Null until a goal is set. */
  nutritionGoal: NutritionGoalSnapshot | null;
  rules: PreferenceRules;
}

/** What the model is told about the profile: `"not set"` is unknown, `[]` is none. */
export interface ModelProfile {
  goal: Goal | typeof MODEL_NOT_SET;
  dailyTarget: MacroValues | typeof MODEL_NOT_SET;
  diets: string[] | typeof MODEL_NOT_SET;
  allergies: string[] | typeof MODEL_NOT_SET;
  excludedIngredients: string[] | typeof MODEL_NOT_SET;
  dislikedFoods: string[] | typeof MODEL_NOT_SET;
}
