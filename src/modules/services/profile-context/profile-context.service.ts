import { Injectable } from '@nestjs/common';
import { DietaryPreference, NutritionGoal } from '../../../generated/prisma/client';
import { CalculationMode, Goal, PreferenceType } from '../../../common/constants';
import { ProfileNotFoundException } from '../../../common/exceptions';
import { NutritionGoalSnapshot, PreferenceRules, ProfileContext } from '../../../common/types';
import { parseEnum, toNumber } from '../../../common/utils';
import { DietaryPreferenceRepository } from '../../data-access/dietary-preference/dietary-preference.repository';
import { NutritionGoalRepository } from '../../data-access/nutrition-goal/nutrition-goal.repository';
import { UserProfileService } from '../user-profile/user-profile.service';

export function toPreferenceRules(preferences: DietaryPreference[]): PreferenceRules {
  const values = (type: PreferenceType): string[] =>
    preferences.filter((p) => p.preferenceType === type).map((p) => p.value);

  return {
    diets: values(PreferenceType.Diet),
    allergies: values(PreferenceType.Allergy),
    excludedIngredients: values(PreferenceType.ExcludedIngredient),
    dislikedFoods: values(PreferenceType.DislikedFood),
  };
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
 * Loads the profile with its current goal and preferences: what menus and the model work with.
 * The goal and the preferences come straight from their repositories by the loaded profile id.
 */
@Injectable()
export class ProfileContextService {
  constructor(
    private readonly userProfileService: UserProfileService,
    private readonly nutritionGoalRepository: NutritionGoalRepository,
    private readonly dietaryPreferenceRepository: DietaryPreferenceRepository,
  ) {}

  /** Null until the profile is filled in. */
  public async find(): Promise<ProfileContext | null> {
    const profile = await this.userProfileService.findCurrent();
    if (!profile) {
      return null;
    }
    const [goal, preferences] = await Promise.all([
      this.nutritionGoalRepository.findCurrent(profile.id),
      this.dietaryPreferenceRepository.findAll(profile.id),
    ]);
    return {
      profileId: profile.id,
      goal: parseEnum(Goal, profile.goal, 'goal'),
      nutritionGoal: goal && toGoalSnapshot(goal),
      rules: toPreferenceRules(preferences),
    };
  }

  public async get(): Promise<ProfileContext> {
    const context = await this.find();
    if (!context) {
      throw new ProfileNotFoundException();
    }
    return context;
  }
}
