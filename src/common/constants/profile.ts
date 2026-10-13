/** Input for the energy formula, not a gender identity. */
export enum Sex {
  Male = 'male',
  Female = 'female',
}

export enum ActivityLevel {
  Sedentary = 'sedentary',
  Light = 'light',
  Moderate = 'moderate',
  Active = 'active',
  VeryActive = 'very_active',
}

export enum Goal {
  LoseWeight = 'lose_weight',
  Maintain = 'maintain',
  GainMuscle = 'gain_muscle',
}

export enum PreferenceType {
  Diet = 'diet',
  Allergy = 'allergy',
  DislikedFood = 'disliked_food',
  ExcludedIngredient = 'excluded_ingredient',
}

export const PROFILE_LIMITS = {
  age: { min: 14, max: 100 },
  heightCm: { min: 100, max: 250 },
  weightKg: { min: 30, max: 300 },
} as const;

/** Weight / height² outside this range is a typo, not a body. */
export const BMI_LIMITS = { min: 12, max: 70 } as const;

/** Below it a weight loss goal is not allowed. */
export const UNDERWEIGHT_BMI = 18.5;

export const PREFERENCE_VALUE_MAX_LENGTH = 120;
export const MAX_PREFERENCES = 50;
