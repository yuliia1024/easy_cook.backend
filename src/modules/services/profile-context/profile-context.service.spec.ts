import { CalculationMode, Goal, PreferenceType } from '../../../common/constants';
import { ProfileNotFoundException } from '../../../common/exceptions';
import { createMock } from '../../../test/create-mock';
import {
  buildNutritionGoal,
  buildPreference,
  buildProfile,
  PROFILE_ID,
} from '../../../test/fixtures';
import { DietaryPreferenceRepository } from '../../data-access/dietary-preference/dietary-preference.repository';
import { NutritionGoalRepository } from '../../data-access/nutrition-goal/nutrition-goal.repository';
import { UserProfileService } from '../user-profile/user-profile.service';
import {
  ProfileContextService,
  toGoalSnapshot,
  toPreferenceRules,
} from './profile-context.service';

describe('ProfileContextService', () => {
  let profileService: jest.Mocked<UserProfileService>;
  let goalRepository: jest.Mocked<NutritionGoalRepository>;
  let preferenceRepository: jest.Mocked<DietaryPreferenceRepository>;
  let service: ProfileContextService;
  const goal = buildNutritionGoal();

  beforeEach(() => {
    profileService = createMock<UserProfileService>();
    profileService.findCurrent.mockResolvedValue(buildProfile({ goal: Goal.LoseWeight }));
    goalRepository = createMock<NutritionGoalRepository>();
    goalRepository.findCurrent.mockResolvedValue(goal);
    preferenceRepository = createMock<DietaryPreferenceRepository>();
    preferenceRepository.findAll.mockResolvedValue([]);
    service = new ProfileContextService(profileService, goalRepository, preferenceRepository);
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

  it('groups the preferences by type', () => {
    expect(
      toPreferenceRules([
        buildPreference({ preferenceType: PreferenceType.Diet, value: 'vegan' }),
        buildPreference({ preferenceType: PreferenceType.Allergy, value: 'peanut' }),
        buildPreference({ preferenceType: PreferenceType.ExcludedIngredient, value: 'pork' }),
        buildPreference({ preferenceType: PreferenceType.DislikedFood, value: 'mushroom' }),
      ]),
    ).toEqual({
      diets: ['vegan'],
      allergies: ['peanut'],
      excludedIngredients: ['pork'],
      dislikedFoods: ['mushroom'],
    });
  });

  describe('find', () => {
    it('loads the profile goal, its current daily target and its rules', async () => {
      preferenceRepository.findAll.mockResolvedValue([
        buildPreference({ preferenceType: PreferenceType.Allergy, value: 'peanut' }),
      ]);

      await expect(service.find()).resolves.toEqual({
        profileId: PROFILE_ID,
        goal: Goal.LoseWeight,
        nutritionGoal: toGoalSnapshot(goal),
        rules: { diets: [], allergies: ['peanut'], excludedIngredients: [], dislikedFoods: [] },
      });
      expect(profileService.findCurrent).toHaveBeenCalledTimes(1);
      expect(goalRepository.findCurrent).toHaveBeenCalledWith(PROFILE_ID);
      expect(preferenceRepository.findAll).toHaveBeenCalledWith(PROFILE_ID);
    });

    it('has no daily target before one is set', async () => {
      goalRepository.findCurrent.mockResolvedValue(null);

      await expect(service.find()).resolves.toMatchObject({ nutritionGoal: null });
    });

    it('is null without a profile and loads nothing else', async () => {
      profileService.findCurrent.mockResolvedValue(null);

      await expect(service.find()).resolves.toBeNull();
      expect(goalRepository.findCurrent).not.toHaveBeenCalled();
      expect(preferenceRepository.findAll).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('returns the context', async () => {
      await expect(service.get()).resolves.toMatchObject({ profileId: PROFILE_ID });
    });

    it('needs a profile', async () => {
      profileService.findCurrent.mockResolvedValue(null);

      await expect(service.get()).rejects.toBeInstanceOf(ProfileNotFoundException);
    });
  });
});
