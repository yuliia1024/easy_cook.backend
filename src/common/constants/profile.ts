/** Input for the energy formula, not a gender identity. */
export enum Sex {
  Male = 'male',
  Female = 'female',
}

export enum ActivityLevel {
  /** Little or no exercise. */
  Sedentary = 'sedentary',
  /** Exercise 1-3 days a week. */
  Light = 'light',
  /** Exercise 3-5 days a week. */
  Moderate = 'moderate',
  /** Exercise 6-7 days a week. */
  Active = 'active',
  /** Hard exercise every day or a physical job. */
  VeryActive = 'very_active',
}

export enum Goal {
  LoseWeight = 'lose_weight',
  Maintain = 'maintain',
  GainMuscle = 'gain_muscle',
}

export enum PreferenceType {
  /** `value` is a `DietTag`. */
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

export const PREFERENCE_VALUE_MAX_LENGTH = 120;
