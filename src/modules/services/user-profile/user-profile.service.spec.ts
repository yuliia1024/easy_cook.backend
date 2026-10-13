import {
  ImplausibleBmiBadRequestException,
  ProfileNotFoundException,
  WeightLossUnderweightBadRequestException,
} from '../../../common/exceptions';
import { createMock } from '../../../test/create-mock';
import { buildProfile, PROFILE_ID } from '../../../test/fixtures';
import { UserProfileRepository } from '../../data-access/user-profile/user-profile.repository';
import { UserProfileService } from './user-profile.service';

describe('UserProfileService', () => {
  let repository: jest.Mocked<UserProfileRepository>;
  let service: UserProfileService;
  const data = {
    age: 30,
    heightCm: 170,
    weightKg: 65,
    sex: 'female',
    activityLevel: 'moderate',
    goal: 'maintain',
  };

  beforeEach(() => {
    repository = createMock<UserProfileRepository>();
    service = new UserProfileService(repository);
  });

  describe('getCurrent', () => {
    it('returns the profile', async () => {
      const profile = buildProfile();
      repository.findCurrent.mockResolvedValue(profile);

      await expect(service.getCurrent()).resolves.toBe(profile);
    });

    it('fails until the profile is filled in', async () => {
      repository.findCurrent.mockResolvedValue(null);

      await expect(service.getCurrent()).rejects.toBeInstanceOf(ProfileNotFoundException);
    });
  });

  describe('save', () => {
    it('creates the first profile', async () => {
      const profile = buildProfile();
      repository.findCurrent.mockResolvedValue(null);
      repository.create.mockResolvedValue(profile);

      await expect(service.save(data)).resolves.toBe(profile);
      expect(repository.create).toHaveBeenCalledWith(data);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('replaces the existing one', async () => {
      repository.findCurrent.mockResolvedValue(buildProfile());

      await service.save(data);

      expect(repository.update).toHaveBeenCalledWith(PROFILE_ID, data);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it.each([
      ['too light for the height (BMI 4.8)', { heightCm: 250, weightKg: 30 }],
      ['too heavy for the height (BMI 300)', { heightCm: 100, weightKg: 300 }],
    ])('rejects a profile %s', async (_case, body) => {
      await expect(service.save({ ...data, ...body })).rejects.toBeInstanceOf(
        ImplausibleBmiBadRequestException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rejects losing weight when underweight (BMI 17.3)', async () => {
      await expect(
        service.save({ ...data, weightKg: 50, goal: 'lose_weight' }),
      ).rejects.toBeInstanceOf(WeightLossUnderweightBadRequestException);
    });

    it('lets an underweight profile maintain or gain', async () => {
      repository.findCurrent.mockResolvedValue(null);

      await service.save({ ...data, weightKg: 50, goal: 'gain_muscle' });

      expect(repository.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('changes the given fields', async () => {
      repository.findCurrent.mockResolvedValue(buildProfile());

      await service.update({ weightKg: 60 });

      expect(repository.update).toHaveBeenCalledWith(PROFILE_ID, { weightKg: 60 });
    });

    it('checks the BMI against the stored height', async () => {
      // 170 cm, 300 kg -> BMI 103.8
      repository.findCurrent.mockResolvedValue(buildProfile());

      await expect(service.update({ weightKg: 300 })).rejects.toBeInstanceOf(
        ImplausibleBmiBadRequestException,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('checks a new goal against the stored weight', async () => {
      repository.findCurrent.mockResolvedValue(buildProfile());

      await service.update({ weightKg: 50 });
      await expect(service.update({ weightKg: 50, goal: 'lose_weight' })).rejects.toBeInstanceOf(
        WeightLossUnderweightBadRequestException,
      );
    });

    it('requires a profile', async () => {
      repository.findCurrent.mockResolvedValue(null);

      await expect(service.update({ age: 31 })).rejects.toBeInstanceOf(ProfileNotFoundException);
    });
  });
});
