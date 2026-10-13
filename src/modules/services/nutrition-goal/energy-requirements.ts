import {
  ActivityLevel,
  Goal,
  KCAL_PER_GRAM,
  MacroName,
  MAX_DAILY_CALORIES_KCAL,
  MIN_DAILY_CALORIES_KCAL,
  Sex,
} from '../../../common/constants';
import { round } from '../../../common/utils';

/**
 * Rule based daily targets, version `NUTRITION_RULE_VERSION`. Change a number here -> bump the
 * version, so stored goals keep saying which rules produced them.
 *
 * - BMR: Mifflin-St Jeor, `10 * kg + 6.25 * cm - 5 * age + (male ? 5 : -161)`.
 * - TDEE: BMR * activity factor.
 * - Goal: calorie adjustment, protein per kg of body weight.
 * - Calories are kept between the minimum for the sex and `MAX_DAILY_CALORIES_KCAL`.
 * - Fat: 25 % of calories. Protein: per kg, kept within 10-30 % of calories. Carbs: the rest,
 *   so they always land in 45-65 % and the goal passes `MACRO_SHARE_LIMITS`.
 */
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  [ActivityLevel.Sedentary]: 1.2,
  [ActivityLevel.Light]: 1.375,
  [ActivityLevel.Moderate]: 1.55,
  [ActivityLevel.Active]: 1.725,
  [ActivityLevel.VeryActive]: 1.9,
};

export const GOAL_RULES: Record<Goal, { calorieFactor: number; proteinPerKg: number }> = {
  [Goal.LoseWeight]: { calorieFactor: 0.85, proteinPerKg: 2.0 },
  [Goal.Maintain]: { calorieFactor: 1, proteinPerKg: 1.6 },
  [Goal.GainMuscle]: { calorieFactor: 1.1, proteinPerKg: 1.8 },
};

export const FAT_SHARE_OF_CALORIES = 0.25;
export const PROTEIN_SHARE_OF_CALORIES = { min: 0.1, max: 0.3 } as const;

export interface EnergyInput {
  age: number;
  heightCm: number;
  weightKg: number;
  sex: Sex;
  activityLevel: ActivityLevel;
  goal: Goal;
}

export interface NutritionTargets {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

export function basalMetabolicRate({ age, heightCm, weightKg, sex }: EnergyInput): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === Sex.Male ? 5 : -161);
}

export function calculateNutritionTargets(input: EnergyInput): NutritionTargets {
  const rules = GOAL_RULES[input.goal];
  const calories = round(
    basalMetabolicRate(input) * ACTIVITY_FACTORS[input.activityLevel] * rules.calorieFactor,
    0,
  );
  const allowed = clamp(calories, MIN_DAILY_CALORIES_KCAL[input.sex], MAX_DAILY_CALORIES_KCAL);

  return macrosForCalories(allowed, input.weightKg, input.goal);
}

/**
 * Splits a calorie goal: 25 % fat, protein per kg of the profile goal (kept within 10-30 % of the
 * calories), carbs for the rest.
 */
export function macrosForCalories(
  caloriesKcal: number,
  weightKg: number,
  goal: Goal,
): NutritionTargets {
  const fatG = (caloriesKcal * FAT_SHARE_OF_CALORIES) / KCAL_PER_GRAM.fat;
  const proteinG = clamp(
    weightKg * GOAL_RULES[goal].proteinPerKg,
    (caloriesKcal * PROTEIN_SHARE_OF_CALORIES.min) / KCAL_PER_GRAM.protein,
    (caloriesKcal * PROTEIN_SHARE_OF_CALORIES.max) / KCAL_PER_GRAM.protein,
  );
  const carbsKcal = caloriesKcal - proteinG * KCAL_PER_GRAM.protein - fatG * KCAL_PER_GRAM.fat;

  return {
    caloriesKcal,
    proteinG: round(proteinG, 0),
    fatG: round(fatG, 0),
    carbsG: round(carbsKcal / KCAL_PER_GRAM.carbs, 0),
  };
}

export interface MacroEnergy {
  /** 4/9/4 kcal per gram of protein/fat/carbs. */
  kcal: number;
  /** Share of `kcal` from each macro, 0-1; all 0 when `kcal` is 0. */
  shares: Record<MacroName, number>;
}

export function macroEnergy({
  proteinG,
  fatG,
  carbsG,
}: Pick<NutritionTargets, 'proteinG' | 'fatG' | 'carbsG'>): MacroEnergy {
  const byMacro: Record<MacroName, number> = {
    protein: proteinG * KCAL_PER_GRAM.protein,
    fat: fatG * KCAL_PER_GRAM.fat,
    carbs: carbsG * KCAL_PER_GRAM.carbs,
  };
  const kcal = byMacro.protein + byMacro.fat + byMacro.carbs;
  const share = (value: number): number => (kcal > 0 ? value / kcal : 0);

  return {
    kcal,
    shares: {
      protein: share(byMacro.protein),
      fat: share(byMacro.fat),
      carbs: share(byMacro.carbs),
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
