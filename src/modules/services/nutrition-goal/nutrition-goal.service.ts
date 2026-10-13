import { Injectable } from '@nestjs/common';
import { NutritionGoal, UserProfile } from '../../../generated/prisma/client';
import {
  ActivityLevel,
  CalculationMode,
  Goal,
  NUTRITION_RULE_VERSION,
  Sex,
} from '../../../common/constants';
import { NutritionGoalNotFoundException } from '../../../common/exceptions';
import { toNumber } from '../../../common/utils';
import { NutritionGoalRepository } from '../../data-access/nutrition-goal/nutrition-goal.repository';
import { UserProfileService } from '../user-profile/user-profile.service';
import { calculateNutritionTargets, NutritionTargets } from './energy-requirements';

@Injectable()
export class NutritionGoalService {
  constructor(
    private readonly nutritionGoalRepository: NutritionGoalRepository,
    private readonly userProfileService: UserProfileService,
  ) {}

  public async getCurrent(): Promise<NutritionGoal> {
    const profile = await this.userProfileService.getCurrent();
    const goal = await this.nutritionGoalRepository.findCurrent(profile.id);
    if (!goal) {
      throw new NutritionGoalNotFoundException();
    }
    return goal;
  }

  /** Newest first. */
  public async getHistory(): Promise<NutritionGoal[]> {
    const profile = await this.userProfileService.getCurrent();
    return this.nutritionGoalRepository.findAll(profile.id);
  }

  public async setManual(targets: NutritionTargets, effectiveFrom?: Date): Promise<NutritionGoal> {
    const profile = await this.userProfileService.getCurrent();

    return this.nutritionGoalRepository.create(profile.id, {
      ...targets,
      calculationMode: CalculationMode.Manual,
      ruleVersion: null,
      ...(effectiveFrom && { effectiveFrom }),
    });
  }

  /** Targets from the profile by the current rules, without saving them. */
  public async preview(): Promise<NutritionTargets> {
    return this.targetsFor(await this.userProfileService.getCurrent());
  }

  /** Calculates the targets from the profile and saves them as the current goal. */
  public async calculate(): Promise<NutritionGoal> {
    const profile = await this.userProfileService.getCurrent();

    return this.nutritionGoalRepository.create(profile.id, {
      ...this.targetsFor(profile),
      calculationMode: CalculationMode.RuleBased,
      ruleVersion: NUTRITION_RULE_VERSION,
    });
  }

  private targetsFor(profile: UserProfile): NutritionTargets {
    return calculateNutritionTargets({
      age: profile.age,
      heightCm: toNumber(profile.heightCm),
      weightKg: toNumber(profile.weightKg),
      sex: profile.sex as Sex,
      activityLevel: profile.activityLevel as ActivityLevel,
      goal: profile.goal as Goal,
    });
  }
}
