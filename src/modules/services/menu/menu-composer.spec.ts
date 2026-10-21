import { CalculationMode, MenuIssueCode, PreferenceType } from '../../../common/constants';
import { ProfileNotFoundException } from '../../../common/exceptions';
import { createMock } from '../../../test/create-mock';
import {
  buildMenuVersion,
  buildNutritionGoal,
  buildPreference,
  buildProfile,
  PROFILE_ID,
} from '../../../test/fixtures';
import { DietaryPreferenceService } from '../dietary-preference/dietary-preference.service';
import { NutritionGoalService } from '../nutrition-goal/nutrition-goal.service';
import { UserProfileService } from '../user-profile/user-profile.service';
import { MenuComposer, MenuContext, toGoalSnapshot } from './menu-composer';

describe('MenuComposer', () => {
  let profileService: jest.Mocked<UserProfileService>;
  let goalService: jest.Mocked<NutritionGoalService>;
  let preferenceService: jest.Mocked<DietaryPreferenceService>;
  let composer: MenuComposer;
  const goal = buildNutritionGoal();
  const context: MenuContext = {
    profileId: PROFILE_ID,
    goal: toGoalSnapshot(goal),
    rules: { diets: [], allergies: [], excludedIngredients: [], dislikedFoods: [] },
  };

  beforeEach(() => {
    profileService = createMock<UserProfileService>();
    profileService.getCurrent.mockResolvedValue(buildProfile());
    goalService = createMock<NutritionGoalService>();
    goalService.findCurrent.mockResolvedValue(goal);
    preferenceService = createMock<DietaryPreferenceService>();
    preferenceService.getAll.mockResolvedValue([]);
    composer = new MenuComposer(profileService, goalService, preferenceService);
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

  it('revalidates a saved version against the current rules', () => {
    const issues = composer.revalidate(buildMenuVersion(), {
      ...context,
      goal: null,
      rules: { ...context.rules, diets: ['gluten_free'] },
    });

    expect(issues).toEqual([
      expect.objectContaining({
        code: MenuIssueCode.DietViolation,
        message: 'Day 1, lunch: Rice with vegetables is not gluten_free',
      }),
    ]);
  });
});
