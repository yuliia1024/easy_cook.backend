import {
  ImplausibleBmiBadRequestException,
  ProfileNotFoundException,
  SessionRequiredUnauthorizedException,
  WeightLossUnderweightBadRequestException,
} from '../../../common/exceptions';
import { getCurrentUserId } from '../../../common/logger';
import { createMock } from '../../../test/create-mock';
import { buildProfile, PROFILE_ID, USER_ID } from '../../../test/fixtures';
import { UserProfileRepository } from '../../data-access/user-profile/user-profile.repository';
import { UserProfileService } from './user-profile.service';

jest.mock('../../../common/logger', () => ({
  ...jest.requireActual('../../../common/logger'),
  getCurrentUserId: jest.fn(),
}));

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
    jest.mocked(getCurrentUserId).mockReturnValue(USER_ID);
  });

  it('reads the profile of the signed-in user', async () => {
    repository.findByUserId.mockResolvedValue(buildProfile());

    await service.getCurrent();

    expect(repository.findByUserId).toHaveBeenCalledWith(USER_ID);
  });

  it('is 401 outside a signed-in request, never falling back to a profile', async () => {
    jest.mocked(getCurrentUserId).mockReturnValue(undefined);

    await expect(service.findCurrent()).rejects.toBeInstanceOf(
      SessionRequiredUnauthorizedException,
    );
    await expect(service.save(data)).rejects.toBeInstanceOf(SessionRequiredUnauthorizedException);
    expect(repository.findByUserId).not.toHaveBeenCalled();
  });

  describe('getCurrent', () => {
    it('returns the profile', async () => {
      const profile = buildProfile();
      repository.findByUserId.mockResolvedValue(profile);

      await expect(service.getCurrent()).resolves.toBe(profile);
    });

    it('fails until the profile is filled in', async () => {
      repository.findByUserId.mockResolvedValue(null);

      await expect(service.getCurrent()).rejects.toBeInstanceOf(ProfileNotFoundException);
    });
  });

  describe('findCurrent', () => {
    it('returns the profile', async () => {
      const profile = buildProfile();
      repository.findByUserId.mockResolvedValue(profile);

      await expect(service.findCurrent()).resolves.toBe(profile);
    });

    it('returns null until the profile is filled in', async () => {
      repository.findByUserId.mockResolvedValue(null);

      await expect(service.findCurrent()).resolves.toBeNull();
    });
  });

  describe('save', () => {
    it('creates or replaces the profile of the current user', async () => {
      const profile = buildProfile();
      repository.upsert.mockResolvedValue(profile);

      await expect(service.save(data)).resolves.toBe(profile);
      expect(repository.upsert).toHaveBeenCalledWith(USER_ID, data);
    });

    it.each([
      ['too light for the height (BMI 4.8)', { heightCm: 250, weightKg: 30 }],
      ['too heavy for the height (BMI 300)', { heightCm: 100, weightKg: 300 }],
    ])('rejects a profile %s', async (_case, body) => {
      await expect(service.save({ ...data, ...body })).rejects.toBeInstanceOf(
        ImplausibleBmiBadRequestException,
      );
      expect(repository.upsert).not.toHaveBeenCalled();
    });

    it('rejects losing weight when underweight (BMI 17.3)', async () => {
      await expect(
        service.save({ ...data, weightKg: 50, goal: 'lose_weight' }),
      ).rejects.toBeInstanceOf(WeightLossUnderweightBadRequestException);
    });

    it('lets an underweight profile maintain or gain', async () => {
      await service.save({ ...data, weightKg: 50, goal: 'gain_muscle' });

      expect(repository.upsert).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('changes the given fields', async () => {
      repository.findByUserId.mockResolvedValue(buildProfile());

      await service.update({ weightKg: 60 });

      expect(repository.update).toHaveBeenCalledWith(PROFILE_ID, { weightKg: 60 });
    });

    it('checks the BMI against the stored height', async () => {
      // 170 cm, 300 kg -> BMI 103.8
      repository.findByUserId.mockResolvedValue(buildProfile());

      await expect(service.update({ weightKg: 300 })).rejects.toBeInstanceOf(
        ImplausibleBmiBadRequestException,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('checks a new goal against the stored weight', async () => {
      repository.findByUserId.mockResolvedValue(buildProfile());

      await service.update({ weightKg: 50 });
      await expect(service.update({ weightKg: 50, goal: 'lose_weight' })).rejects.toBeInstanceOf(
        WeightLossUnderweightBadRequestException,
      );
    });

    it('requires a profile', async () => {
      repository.findByUserId.mockResolvedValue(null);

      await expect(service.update({ age: 31 })).rejects.toBeInstanceOf(ProfileNotFoundException);
    });
  });
});
