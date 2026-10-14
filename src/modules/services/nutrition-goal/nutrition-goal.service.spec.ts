import {
  CalculationMode,
  Goal,
  NUTRITION_RULE_VERSION,
  Sex,
  SortOrder,
} from '../../../common/constants';
import {
  CaloriesBelowMinimumBadRequestException,
  MacroShareBadRequestException,
  MacrosCaloriesMismatchBadRequestException,
  NutritionGoalNotFoundException,
  ProfileNotFoundException,
} from '../../../common/exceptions';
import { createMock } from '../../../test/create-mock';
import { Prisma } from '../../../generated/prisma/client';
import { buildNutritionGoal, buildProfile, PROFILE_ID } from '../../../test/fixtures';
import { NutritionGoalRepository } from '../../data-access/nutrition-goal/nutrition-goal.repository';
import { UserProfileService } from '../user-profile/user-profile.service';
import { macrosForCalories } from './energy-requirements';
import { NutritionGoalService } from './nutrition-goal.service';

const d = (value: number): Prisma.Decimal => new Prisma.Decimal(value);

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

  describe('findCurrent', () => {
    it('returns the goal in effect or null', async () => {
      const goal = buildNutritionGoal();
      repository.findCurrent.mockResolvedValueOnce(goal).mockResolvedValueOnce(null);

      await expect(service.findCurrent()).resolves.toBe(goal);
      await expect(service.findCurrent()).resolves.toBeNull();
      expect(repository.findCurrent).toHaveBeenCalledWith(PROFILE_ID);
    });
  });

  describe('getHistory', () => {
    it('lists the profile goals newest first by default', async () => {
      const goals = [buildNutritionGoal()];
      repository.findAll.mockResolvedValue(goals);

      await expect(service.getHistory()).resolves.toBe(goals);
      expect(repository.findAll).toHaveBeenCalledWith(PROFILE_ID, SortOrder.Desc);
    });

    it('passes the requested order', async () => {
      await service.getHistory(SortOrder.Asc);

      expect(repository.findAll).toHaveBeenCalledWith(PROFILE_ID, SortOrder.Asc);
    });
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

    it.each([
      [Sex.Female, 1200, 1199],
      [Sex.Male, 1500, 1499],
    ])('%s: allows %i kcal, rejects %i', async (sex, allowed, rejected) => {
      profileService.getCurrent.mockResolvedValue(buildProfile({ sex }));
      const balanced = (kcal: number) => macrosForCalories(kcal, 65, Goal.Maintain);

      await service.setManual(balanced(allowed));
      await expect(service.setManual(balanced(rejected))).rejects.toBeInstanceOf(
        CaloriesBelowMinimumBadRequestException,
      );
      expect(repository.create).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['too little energy in the macros', { proteinG: 80, fatG: 50, carbsG: 200 }],
      ['too much energy in the macros', { proteinG: 150, fatG: 80, carbsG: 330 }],
    ])('rejects %s', async (_case, macros) => {
      await expect(service.setManual({ caloriesKcal: 2000, ...macros })).rejects.toBeInstanceOf(
        MacrosCaloriesMismatchBadRequestException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it.each([
      // 1800 kcal: protein 200 g = 800 kcal (44 %)
      ['protein over 35 %', { proteinG: 200, fatG: 50, carbsG: 137 }, 'Protein must be 10-35 %'],
      // fat 30 g = 270 kcal (15 %)
      ['fat under 20 %', { proteinG: 100, fatG: 30, carbsG: 282 }, 'Fat must be 20-35 %'],
      // protein 34 %, fat 34 %, carbs 144 g = 576 kcal (32 %)
      ['carbs under 45 %', { proteinG: 153, fatG: 68, carbsG: 144 }, 'Carbs must be 45-65 %'],
    ])('rejects %s', async (_case, macros, message) => {
      const result = service.setManual({ caloriesKcal: 1800, ...macros });

      await expect(result).rejects.toBeInstanceOf(MacroShareBadRequestException);
      await expect(result).rejects.toThrow(message);
    });

    it('accepts shares up to one point outside the limits (rounding)', async () => {
      // protein 644 kcal (35.8 %), fat 360 kcal (20 %), carbs 796 kcal (44.2 %)
      await service.setManual({ caloriesKcal: 1800, proteinG: 161, fatG: 40, carbsG: 199 });

      expect(repository.create).toHaveBeenCalled();
    });

    it('fails loudly for a sex the rules do not know', async () => {
      profileService.getCurrent.mockResolvedValue(buildProfile({ sex: 'other' }));

      await expect(service.setManual(targets)).rejects.toThrow('Unknown sex "other"');
    });
  });

  describe('preview', () => {
    it('calculates from the profile without saving', async () => {
      await expect(service.preview()).resolves.toEqual(targets);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('splits given calories into macros for the profile', async () => {
      await expect(service.preview(1500)).resolves.toEqual({
        caloriesKcal: 1500,
        proteinG: 104,
        fatG: 42,
        carbsG: 177,
      });
    });

    it('rejects calories below the minimum for the profile sex', async () => {
      profileService.getCurrent.mockResolvedValue(buildProfile({ sex: Sex.Male }));

      await expect(service.preview(1499)).rejects.toBeInstanceOf(
        CaloriesBelowMinimumBadRequestException,
      );
    });
  });

  it('raises a calculated goal to the minimum for the sex', async () => {
    profileService.getCurrent.mockResolvedValue(
      buildProfile({ age: 80, heightCm: d(150), weightKg: d(45), goal: Goal.LoseWeight }),
    );

    await expect(service.preview()).resolves.toMatchObject({ caloriesKcal: 1200 });
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
