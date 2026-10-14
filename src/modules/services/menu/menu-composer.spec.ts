import { Prisma } from '../../../generated/prisma/client';
import {
  CalculationMode,
  MealType,
  MenuGeneratedBy,
  MenuIssueCode,
  PreferenceType,
} from '../../../common/constants';
import { ProfileNotFoundException } from '../../../common/exceptions';
import { createMock } from '../../../test/create-mock';
import {
  buildMenuVersion,
  buildNutritionGoal,
  buildPreference,
  buildProfile,
  buildRecipe,
  buildRecipeSnapshot,
  PROFILE_ID,
  RECIPE_ID,
} from '../../../test/fixtures';
import { DietaryPreferenceService } from '../dietary-preference/dietary-preference.service';
import { NutritionGoalService } from '../nutrition-goal/nutrition-goal.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { RecipeService } from '../recipe/recipe.service';
import { UserProfileService } from '../user-profile/user-profile.service';
import { MenuComposer, MenuContext, toGoalSnapshot } from './menu-composer';

describe('MenuComposer', () => {
  let profileService: jest.Mocked<UserProfileService>;
  let goalService: jest.Mocked<NutritionGoalService>;
  let preferenceService: jest.Mocked<DietaryPreferenceService>;
  let recipeService: jest.Mocked<RecipeService>;
  let composer: MenuComposer;
  const goal = buildNutritionGoal();
  const context: MenuContext = {
    profileId: PROFILE_ID,
    goal: toGoalSnapshot(goal),
    rules: { diets: [], allergies: [], excludedIngredients: [], dislikedFoods: [] },
  };
  const meta = { generatedBy: MenuGeneratedBy.Manual, notes: 'note' };

  beforeEach(() => {
    profileService = createMock<UserProfileService>();
    profileService.getCurrent.mockResolvedValue(buildProfile());
    goalService = createMock<NutritionGoalService>();
    goalService.findCurrent.mockResolvedValue(goal);
    preferenceService = createMock<DietaryPreferenceService>();
    preferenceService.getAll.mockResolvedValue([]);
    recipeService = createMock<RecipeService>();
    recipeService.findByIds.mockResolvedValue(new Map([[RECIPE_ID, buildRecipe()]]));
    composer = new MenuComposer(
      profileService,
      goalService,
      preferenceService,
      recipeService,
      new NutritionService(),
    );
  });

  it('snapshots a goal with plain numbers', () => {
    expect(toGoalSnapshot(goal)).toEqual({
      goalId: goal.id,
      caloriesKcal: 2000,
      proteinG: 104,
      fatG: 56,
      carbsG: 270,
      calculationMode: CalculationMode.Manual,
      ruleVersion: null,
    });
  });

  describe('context', () => {
    it('loads the profile, its current goal and its rules', async () => {
      preferenceService.getAll.mockResolvedValue([
        buildPreference({ preferenceType: PreferenceType.Allergy, value: 'peanut' }),
      ]);

      await expect(composer.context()).resolves.toEqual({
        profileId: PROFILE_ID,
        goal: toGoalSnapshot(goal),
        rules: { diets: [], allergies: ['peanut'], excludedIngredients: [], dislikedFoods: [] },
      });
    });

    it('has no goal before one is set', async () => {
      goalService.findCurrent.mockResolvedValue(null);

      await expect(composer.context()).resolves.toMatchObject({ goal: null });
    });

    it('needs a profile', async () => {
      profileService.getCurrent.mockRejectedValue(new ProfileNotFoundException());

      await expect(composer.context()).rejects.toBeInstanceOf(ProfileNotFoundException);
    });
  });

  describe('build', () => {
    it('sorts the days, snapshots the recipes and stores the composition with its issues', async () => {
      const built = await composer.build(
        [
          {
            dayIndex: 1,
            date: null,
            meals: [{ mealType: MealType.Lunch, recipeId: RECIPE_ID, servings: 2 }],
          },
          {
            dayIndex: 0,
            date: null,
            meals: [{ mealType: MealType.Dinner, recipeId: RECIPE_ID, servings: 1 }],
          },
        ],
        context,
        meta,
      );

      expect(recipeService.findByIds).toHaveBeenCalledWith([RECIPE_ID, RECIPE_ID]);
      expect(built.version.days.map((day) => day.dayIndex)).toEqual([0, 1]);
      expect(built.version.days[1].meals).toEqual([
        {
          mealType: MealType.Lunch,
          recipeId: RECIPE_ID,
          servings: 2,
          recipeSnapshot: buildRecipeSnapshot(),
        },
      ]);
      expect(built.version).toMatchObject({
        generatedBy: MenuGeneratedBy.Manual,
        notes: 'note',
        nutritionGoalsSnapshot: toGoalSnapshot(goal),
      });
      // 130 and 260 kcal against a 2000 kcal goal: both days are far below it.
      expect(built.issues.map((issue) => issue.code)).toEqual([
        MenuIssueCode.CaloriesOffTarget,
        MenuIssueCode.CaloriesOffTarget,
      ]);
      expect(built.version.compositionSnapshot).toMatchObject({
        dailyAverage: { kcal: 195 },
        issues: built.issues,
      });
    });

    it('stores a JSON null without a goal', async () => {
      const built = await composer.build(
        [
          {
            dayIndex: 0,
            date: null,
            meals: [{ mealType: MealType.Lunch, recipeId: RECIPE_ID, servings: 1 }],
          },
        ],
        { ...context, goal: null },
        meta,
      );

      expect(built.version.nutritionGoalsSnapshot).toBe(Prisma.JsonNull);
      expect(built.issues).toEqual([]);
    });

    it('keeps the snapshot of a deleted recipe', async () => {
      const snapshot = buildRecipeSnapshot({ name: 'Old soup' });

      const built = await composer.build(
        [
          {
            dayIndex: 0,
            date: null,
            meals: [
              { mealType: MealType.Lunch, recipeId: null, recipeSnapshot: snapshot, servings: 1 },
            ],
          },
        ],
        context,
        meta,
      );

      expect(recipeService.findByIds).toHaveBeenCalledWith([]);
      expect(built.version.days[0].meals[0]).toEqual({
        mealType: MealType.Lunch,
        recipeId: null,
        servings: 1,
        recipeSnapshot: snapshot,
      });
    });

    it('reports unknown recipes without building', async () => {
      const built = await composer.build(
        [
          {
            dayIndex: 0,
            date: null,
            meals: [{ mealType: MealType.Lunch, recipeId: 'gone', servings: 1 }],
          },
        ],
        context,
        meta,
      );

      expect(built).toEqual({
        version: null,
        issues: [
          expect.objectContaining({
            code: MenuIssueCode.RecipeNotFound,
            message: 'Day 1, lunch: recipe gone does not exist',
            dayIndex: 0,
            position: 0,
            recipeId: 'gone',
          }),
        ],
      });
    });
  });

  it('revalidates a saved version against the current rules', () => {
    const issues = composer.revalidate(buildMenuVersion(), {
      ...context,
      goal: null,
      rules: { ...context.rules, diets: ['vegetarian'] },
    });

    expect(issues).toEqual([
      expect.objectContaining({
        code: MenuIssueCode.DietViolation,
        message: 'Day 1, lunch: Rice with vegetables is not vegetarian',
      }),
    ]);
  });
});
