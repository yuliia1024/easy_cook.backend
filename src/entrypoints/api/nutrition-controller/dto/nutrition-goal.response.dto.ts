import { NutritionGoal } from '../../../../generated/prisma/client';
import { CalculationMode } from '../../../../common/constants';
import { toNumber } from '../../../../common/utils';
import { NutritionTargets } from '../../../../modules/services/nutrition-goal/energy-requirements';

export class NutritionTargetsResponseDto implements NutritionTargets {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

export class NutritionGoalResponseDto extends NutritionTargetsResponseDto {
  id: string;
  calculationMode: CalculationMode;
  /** Version of the formulas for rule based goals. */
  ruleVersion: string | null;
  effectiveFrom: Date;

  static from(goal: NutritionGoal): NutritionGoalResponseDto {
    return {
      id: goal.id,
      caloriesKcal: toNumber(goal.caloriesKcal),
      proteinG: toNumber(goal.proteinG),
      fatG: toNumber(goal.fatG),
      carbsG: toNumber(goal.carbsG),
      calculationMode: goal.calculationMode as CalculationMode,
      ruleVersion: goal.ruleVersion,
      effectiveFrom: goal.effectiveFrom,
    };
  }
}
