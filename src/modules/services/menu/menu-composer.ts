import { Injectable } from '@nestjs/common';
import { NutritionGoal, Prisma } from '../../../generated/prisma/client';
import { CalculationMode, MenuIssueCode, MenuIssueSeverity } from '../../../common/constants';
import {
  MenuDayDraft,
  MenuIssue,
  NutritionGoalSnapshot,
  PreferenceRules,
} from '../../../common/types';
import { parseEnum, toNumber } from '../../../common/utils';
import { MenuVersionData, MenuVersionWithDays } from '../../data-access/menu/menu.repository';
import { DietaryPreferenceService } from '../dietary-preference/dietary-preference.service';
import { NutritionGoalService } from '../nutrition-goal/nutrition-goal.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { RecipeService } from '../recipe/recipe.service';
import { UserProfileService } from '../user-profile/user-profile.service';
import { composeMenu, ResolvedDay, resolveVersion, snapshotRecipe } from './menu-composition';
import { toPreferenceRules, validateMenu } from './menu-rules';

/** What a menu is built against: the profile, its current goal and its preferences. */
export interface MenuContext {
  profileId: string;
  goal: NutritionGoalSnapshot | null;
  rules: PreferenceRules;
}

export interface BuiltVersion {
  /** Null when a recipe does not exist; `issues` then lists only those. */
  version: MenuVersionData | null;
  issues: MenuIssue[];
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
 * Turns a menu draft into a version: resolves the recipes, snapshots them, calculates the
 * nutrition of every meal and day and validates the menu against the profile. Shared by manual
 * edits and the planner, so both follow exactly the same rules.
 */
@Injectable()
export class MenuComposer {
  constructor(
    private readonly userProfileService: UserProfileService,
    private readonly nutritionGoalService: NutritionGoalService,
    private readonly dietaryPreferenceService: DietaryPreferenceService,
    private readonly recipeService: RecipeService,
    private readonly nutritionService: NutritionService,
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

  public async build(
    draft: MenuDayDraft[],
    context: MenuContext,
    meta: { generatedBy: string; notes: string | null },
  ): Promise<BuiltVersion> {
    const days = [...draft].sort((a, b) => a.dayIndex - b.dayIndex);
    const recipes = await this.recipeService.findByIds(
      days.flatMap((day) => day.meals.flatMap((meal) => (meal.recipeId ? [meal.recipeId] : []))),
    );

    const missing: MenuIssue[] = [];
    const resolved: ResolvedDay[] = days.map((day) => ({
      dayIndex: day.dayIndex,
      date: day.date,
      meals: day.meals.flatMap((meal, position) => {
        const { mealType, servings } = meal;
        if (!meal.recipeId && meal.recipeSnapshot) {
          return [{ mealType, servings, recipeId: null, recipe: meal.recipeSnapshot }];
        }
        const recipe = recipes.get(meal.recipeId);
        if (!recipe) {
          missing.push({
            severity: MenuIssueSeverity.Error,
            code: MenuIssueCode.RecipeNotFound,
            message: `Day ${day.dayIndex + 1}, ${meal.mealType}: recipe ${meal.recipeId} does not exist`,
            dayIndex: day.dayIndex,
            position,
            recipeId: meal.recipeId,
          });
          return [];
        }
        const snapshot = snapshotRecipe(recipe, this.nutritionService.calculateRecipe(recipe));
        return [{ mealType, servings, recipeId: meal.recipeId, recipe: snapshot }];
      }),
    }));
    if (missing.length > 0) {
      return { version: null, issues: missing };
    }

    const composed = composeMenu(resolved);
    const issues = validateMenu(resolved, composed.days, context.rules, context.goal);

    return {
      issues,
      version: {
        ...meta,
        nutritionGoalsSnapshot: context.goal
          ? (context.goal as unknown as Prisma.InputJsonObject)
          : Prisma.JsonNull,
        compositionSnapshot: { ...composed, issues } as unknown as Prisma.InputJsonObject,
        days: resolved.map((day) => ({
          dayIndex: day.dayIndex,
          date: day.date,
          meals: day.meals.map((meal) => ({
            mealType: meal.mealType,
            recipeId: meal.recipeId,
            servings: meal.servings,
            recipeSnapshot: meal.recipe as unknown as Prisma.InputJsonObject,
          })),
        })),
      },
    };
  }

  /** A saved version checked again against the current goal and preferences. */
  public revalidate(version: MenuVersionWithDays, context: MenuContext): MenuIssue[] {
    const days = resolveVersion(version);
    return validateMenu(days, composeMenu(days).days, context.rules, context.goal);
  }
}
