import { Injectable } from '@nestjs/common';
import { NutritionGoal } from '../../../generated/prisma/client';
import { CalculationMode } from '../../../common/constants';
import { MenuIssue, NutritionGoalSnapshot, PreferenceRules } from '../../../common/types';
import { parseEnum, toNumber } from '../../../common/utils';
import { MenuVersionWithDays } from '../../data-access/menu/menu.repository';
import { DietaryPreferenceService } from '../dietary-preference/dietary-preference.service';
import { NutritionGoalService } from '../nutrition-goal/nutrition-goal.service';
import { UserProfileService } from '../user-profile/user-profile.service';
import { composeMenu, resolveVersion } from './menu-composition';
import { toPreferenceRules, validateMenu } from './menu-rules';

/** What a menu is checked against: the profile, its current goal and its preferences. */
export interface MenuContext {
  profileId: string;
  goal: NutritionGoalSnapshot | null;
  rules: PreferenceRules;
}

export function toGoalSnapshot(goal: NutritionGoal): NutritionGoalSnapshot {
  return {
    goalId: goal.id,
    caloriesKcal: toNumber(goal.caloriesKcal),
    proteinG: toNumber(goal.proteinG),
    fatG: toNumber(goal.fatG),
    carbsG: toNumber(goal.carbsG),
    calculationMode: parseEnum(CalculationMode, goal.calculationMode, 'calculation mode'),
    ruleVersion: goal.ruleVersion,
  };
}

/**
 * Checks saved menu versions against the profile: recalculates the nutrition of every meal and
 * day from the recipe snapshots and validates the menu against the current goal and preferences.
 */
@Injectable()
export class MenuComposer {
  constructor(
    private readonly userProfileService: UserProfileService,
    private readonly nutritionGoalService: NutritionGoalService,
    private readonly dietaryPreferenceService: DietaryPreferenceService,
  ) {}

  public async context(): Promise<MenuContext> {
    const profile = await this.userProfileService.getCurrent();
    const [goal, preferences] = await Promise.all([
      this.nutritionGoalService.findCurrent(),
      this.dietaryPreferenceService.getAll(),
    ]);
    return {
      profileId: profile.id,
      goal: goal && toGoalSnapshot(goal),
      rules: toPreferenceRules(preferences),
    };
  }

  /** A saved version checked again against the current goal and preferences. */
  public revalidate(version: MenuVersionWithDays, context: MenuContext): MenuIssue[] {
    const days = resolveVersion(version);
    return validateMenu(days, composeMenu(days).days, context.rules, context.goal);
  }
}
