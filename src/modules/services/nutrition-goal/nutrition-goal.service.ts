import { Injectable } from '@nestjs/common';
import { NutritionGoal, UserProfile } from '../../../generated/prisma/client';
import {
  ActivityLevel,
  CalculationMode,
  Goal,
  GOAL_KCAL_TOLERANCE,
  MACRO_SHARE_LIMITS,
  MACRO_SHARE_TOLERANCE,
  MacroName,
  MIN_DAILY_CALORIES_KCAL,
  NUTRITION_RULE_VERSION,
  Sex,
  SortOrder,
} from '../../../common/constants';
import {
  CaloriesBelowMinimumBadRequestException,
  MacroShareBadRequestException,
  MacrosCaloriesMismatchBadRequestException,
  NutritionGoalNotFoundException,
} from '../../../common/exceptions';
import { parseEnum, toNumber } from '../../../common/utils';
import { NutritionGoalRepository } from '../../data-access/nutrition-goal/nutrition-goal.repository';
import { UserProfileService } from '../user-profile/user-profile.service';
import {
  calculateNutritionTargets,
  EnergyInput,
  macroEnergy,
  macrosForCalories,
  NutritionTargets,
} from './energy-requirements';

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

  /** The goal in effect now, or null when none is set yet. */
  public async findCurrent(): Promise<NutritionGoal | null> {
    const profile = await this.userProfileService.getCurrent();
    return this.nutritionGoalRepository.findCurrent(profile.id);
  }

  /** By `effectiveFrom`, newest first by default. */
  public async getHistory(sortOrder: SortOrder = SortOrder.Desc): Promise<NutritionGoal[]> {
    const profile = await this.userProfileService.getCurrent();
    return this.nutritionGoalRepository.findAll(profile.id, sortOrder);
  }

  /**
   * Calories must not go below the minimum for the profile sex; protein, fat and carbs must add up
   * to the calories and stay within the healthy share of each.
   */
  public async setManual(targets: NutritionTargets, effectiveFrom?: Date): Promise<NutritionGoal> {
    const profile = await this.userProfileService.getCurrent();
    this.assertCaloriesAllowed(profile, targets.caloriesKcal);
    this.assertMacrosBalanced(targets);

    return this.nutritionGoalRepository.create(profile.id, {
      ...targets,
      calculationMode: CalculationMode.Manual,
      ruleVersion: null,
      ...(effectiveFrom && { effectiveFrom }),
    });
  }

  /**
   * Targets from the profile by the current rules, without saving them. With `caloriesKcal`,
   * only splits those calories into macros for the profile (the "recalculate macros" action).
   */
  public async preview(caloriesKcal?: number): Promise<NutritionTargets> {
    const profile = await this.userProfileService.getCurrent();
    if (caloriesKcal === undefined) {
      return this.targetsFor(profile);
    }

    this.assertCaloriesAllowed(profile, caloriesKcal);
    const { weightKg, goal } = this.energyInput(profile);
    return macrosForCalories(caloriesKcal, weightKg, goal);
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
    return calculateNutritionTargets(this.energyInput(profile));
  }

  private energyInput(profile: UserProfile): EnergyInput {
    return {
      age: profile.age,
      heightCm: toNumber(profile.heightCm),
      weightKg: toNumber(profile.weightKg),
      sex: parseEnum(Sex, profile.sex, 'sex'),
      activityLevel: parseEnum(ActivityLevel, profile.activityLevel, 'activity level'),
      goal: parseEnum(Goal, profile.goal, 'goal'),
    };
  }

  private assertCaloriesAllowed(profile: UserProfile, caloriesKcal: number): void {
    const minKcal = MIN_DAILY_CALORIES_KCAL[parseEnum(Sex, profile.sex, 'sex')];
    if (caloriesKcal < minKcal) {
      throw new CaloriesBelowMinimumBadRequestException(minKcal);
    }
  }

  private assertMacrosBalanced(targets: NutritionTargets): void {
    const { kcal, shares } = macroEnergy(targets);

    if (Math.abs(kcal - targets.caloriesKcal) > targets.caloriesKcal * GOAL_KCAL_TOLERANCE) {
      throw new MacrosCaloriesMismatchBadRequestException(
        kcal,
        targets.caloriesKcal,
        GOAL_KCAL_TOLERANCE,
      );
    }
    for (const macro of Object.keys(MACRO_SHARE_LIMITS) as MacroName[]) {
      const limits = MACRO_SHARE_LIMITS[macro];
      if (
        shares[macro] < limits.min - MACRO_SHARE_TOLERANCE ||
        shares[macro] > limits.max + MACRO_SHARE_TOLERANCE
      ) {
        throw new MacroShareBadRequestException(macro, shares[macro], limits);
      }
    }
  }
}
