import { ActivityLevel, Goal, KCAL_PER_GRAM, Sex } from '../../../common/constants';
import { round } from '../../../common/utils';

/**
 * Rule based daily targets, version `NUTRITION_RULE_VERSION`. Change a number here -> bump the
 * version, so stored goals keep saying which rules produced them.
 *
 * - BMR: Mifflin-St Jeor, `10 * kg + 6.25 * cm - 5 * age + (male ? 5 : -161)`.
 * - TDEE: BMR * activity factor.
 * - Goal: calorie adjustment, protein per kg of body weight.
 * - Fat: 25 % of calories. Carbs: the rest.
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
  const calories =
    basalMetabolicRate(input) * ACTIVITY_FACTORS[input.activityLevel] * rules.calorieFactor;

  const proteinG = input.weightKg * rules.proteinPerKg;
  const fatG = (calories * FAT_SHARE_OF_CALORIES) / KCAL_PER_GRAM.fat;
  const carbsKcal = calories - proteinG * KCAL_PER_GRAM.protein - fatG * KCAL_PER_GRAM.fat;

  return {
    caloriesKcal: round(calories, 0),
    proteinG: round(proteinG, 0),
    fatG: round(fatG, 0),
    carbsG: round(Math.max(carbsKcal, 0) / KCAL_PER_GRAM.carbs, 0),
  };
}
