import { CalculationMode, NUTRITION_RULE_VERSION } from '../../../common/constants';
import {
  NutritionGoalNotFoundException,
  ProfileNotFoundException,
} from '../../../common/exceptions';
import { createMock } from '../../../test/create-mock';
import { buildNutritionGoal, buildProfile, PROFILE_ID } from '../../../test/fixtures';
import { NutritionGoalRepository } from '../../data-access/nutrition-goal/nutrition-goal.repository';
import { UserProfileService } from '../user-profile/user-profile.service';
import { NutritionGoalService } from './nutrition-goal.service';

describe('NutritionGoalService', () => {
  let repository: jest.Mocked<NutritionGoalRepository>;
  let profileService: jest.Mocked<UserProfileService>;
  let service: NutritionGoalService;
  /** What the rules give for `buildProfile()` (female, 30, 170 cm, 65 kg, moderate, maintain). */
  const targets = { caloriesKcal: 2172, proteinG: 104, fatG: 60, carbsG: 303 };

  beforeEach(() => {
    repository = createMock<NutritionGoalRepository>();
    profileService = createMock<UserProfileService>();
    profileService.getCurrent.mockResolvedValue(buildProfile());
    service = new NutritionGoalService(repository, profileService);
  });

  describe('getCurrent', () => {
    it('returns the goal in effect', async () => {
      const goal = buildNutritionGoal();
      repository.findCurrent.mockResolvedValue(goal);

      await expect(service.getCurrent()).resolves.toBe(goal);
      expect(repository.findCurrent).toHaveBeenCalledWith(PROFILE_ID);
    });

    it('fails when no goal was set', async () => {
      repository.findCurrent.mockResolvedValue(null);

      await expect(service.getCurrent()).rejects.toBeInstanceOf(NutritionGoalNotFoundException);
    });

    it('needs a profile', async () => {
      profileService.getCurrent.mockRejectedValue(new ProfileNotFoundException());

      await expect(service.getCurrent()).rejects.toBeInstanceOf(ProfileNotFoundException);
    });
  });

  it('getHistory lists the profile goals', async () => {
    const goals = [buildNutritionGoal()];
    repository.findAll.mockResolvedValue(goals);

    await expect(service.getHistory()).resolves.toBe(goals);
    expect(repository.findAll).toHaveBeenCalledWith(PROFILE_ID);
  });

  describe('setManual', () => {
    it('stores the given targets without a rule version', async () => {
      await service.setManual(targets);

      expect(repository.create).toHaveBeenCalledWith(PROFILE_ID, {
        ...targets,
        calculationMode: CalculationMode.Manual,
        ruleVersion: null,
      });
    });

    it('keeps a given start date', async () => {
      const effectiveFrom = new Date('2026-11-01T00:00:00Z');

      await service.setManual(targets, effectiveFrom);

      expect(repository.create).toHaveBeenCalledWith(
        PROFILE_ID,
        expect.objectContaining({ effectiveFrom }),
      );
    });
  });

  it('preview calculates from the profile without saving', async () => {
    await expect(service.preview()).resolves.toEqual(targets);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('calculate saves a rule based goal with the rule version', async () => {
    await service.calculate();

    expect(repository.create).toHaveBeenCalledWith(PROFILE_ID, {
      ...targets,
      calculationMode: CalculationMode.RuleBased,
      ruleVersion: NUTRITION_RULE_VERSION,
    });
  });
});
