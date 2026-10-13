import { Sex } from './profile';

export enum CalculationMode {
  Manual = 'manual',
  RuleBased = 'rule_based',
}

export enum MenuGeneratedBy {
  Manual = 'manual',
  Llm = 'llm',
}

/** Bump when the formulas in `energy-requirements.ts` change; stored with every rule based goal. */
export const NUTRITION_RULE_VERSION = 'mifflin-st-jeor-v2';

export const KCAL_PER_GRAM = { protein: 4, fat: 9, carbs: 4 } as const;

/** Lowest daily calorie goal without medical supervision; calculated goals are raised to it. */
export const MIN_DAILY_CALORIES_KCAL: Record<Sex, number> = {
  [Sex.Female]: 1200,
  [Sex.Male]: 1500,
};

export const MAX_DAILY_CALORIES_KCAL = 6000;

export type MacroName = 'protein' | 'fat' | 'carbs';

/**
 * Acceptable macronutrient distribution ranges (share of the energy from protein, fat and carbs).
 * A daily goal outside them is rejected; calculated goals always fall inside.
 */
export const MACRO_SHARE_LIMITS: Record<MacroName, { min: number; max: number }> = {
  protein: { min: 0.1, max: 0.35 },
  fat: { min: 0.2, max: 0.35 },
  carbs: { min: 0.45, max: 0.65 },
};

/** Slack for the share limits, so goals rounded to whole grams are not rejected. */
export const MACRO_SHARE_TOLERANCE = 0.01;

/** How far the energy of the macros (4/9/4) may be from the calorie goal. */
export const GOAL_KCAL_TOLERANCE = 0.1;

/** A goal can start from the beginning of today up to a year ahead. */
export const GOAL_EFFECTIVE_FROM_MAX_PAST_HOURS = 24;
export const GOAL_EFFECTIVE_FROM_MAX_FUTURE_DAYS = 365;
