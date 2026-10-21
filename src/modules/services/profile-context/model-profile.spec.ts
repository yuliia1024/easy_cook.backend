import { CalculationMode, Goal, MODEL_NOT_SET } from '../../../common/constants';
import { ProfileContext } from '../../../common/types';
import { PROFILE_ID } from '../../../test/fixtures';
import { profileMessage, toModelProfile } from './model-profile';

describe('toModelProfile', () => {
  const context: ProfileContext = {
    profileId: PROFILE_ID,
    goal: Goal.LoseWeight,
    nutritionGoal: {
      goalId: 'g',
      caloriesKcal: 1799.6,
      proteinG: 120.4,
      fatG: 60,
      carbsG: 190.5,
      calculationMode: CalculationMode.Manual,
      ruleVersion: null,
    },
    rules: {
      diets: ['vegetarian'],
      allergies: ['peanut'],
      excludedIngredients: ['pork'],
      dislikedFoods: ['olive'],
    },
  };

  it('keeps the goal, the rounded daily target and the preferences', () => {
    expect(toModelProfile(context)).toEqual({
      goal: Goal.LoseWeight,
      dailyTarget: { kcal: 1800, proteinG: 120, fatG: 60, carbsG: 191 },
      diets: ['vegetarian'],
      allergies: ['peanut'],
      excludedIngredients: ['pork'],
      dislikedFoods: ['olive'],
    });
  });

  it('marks the daily target as not set before a goal is set, never as zeros', () => {
    expect(toModelProfile({ ...context, nutritionGoal: null })).toMatchObject({
      goal: Goal.LoseWeight,
      dailyTarget: MODEL_NOT_SET,
    });
  });

  it('keeps no preferences as empty lists: known to be none', () => {
    const rules = { diets: [], allergies: [], excludedIngredients: [], dislikedFoods: [] };

    expect(toModelProfile({ ...context, rules })).toMatchObject(rules);
  });

  it('marks everything as not set without a profile', () => {
    expect(toModelProfile(null)).toEqual({
      goal: MODEL_NOT_SET,
      dailyTarget: MODEL_NOT_SET,
      diets: MODEL_NOT_SET,
      allergies: MODEL_NOT_SET,
      excludedIngredients: MODEL_NOT_SET,
      dislikedFoods: MODEL_NOT_SET,
    });
  });
});

describe('profileMessage', () => {
  it('sends the profile as a user message of JSON', () => {
    expect(profileMessage(null)).toEqual({
      role: 'user',
      content:
        '{"profile":{"goal":"not set","dailyTarget":"not set","diets":"not set",' +
        '"allergies":"not set","excludedIngredients":"not set","dislikedFoods":"not set"}}',
    });
  });
});
