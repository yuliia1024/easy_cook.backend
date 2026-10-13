import { DietTag, PreferenceType } from '../../../common/constants';
import {
  ConflictingDietsBadRequestException,
  DietaryPreferenceExistsConflictException,
  DietaryPreferenceNotFoundException,
  TooManyPreferencesBadRequestException,
  UnknownDietBadRequestException,
} from '../../../common/exceptions';
import { createMock } from '../../../test/create-mock';
import { buildPreference, buildProfile, PROFILE_ID } from '../../../test/fixtures';
import { DietaryPreferenceRepository } from '../../data-access/dietary-preference/dietary-preference.repository';
import { UserProfileService } from '../user-profile/user-profile.service';
import { DietaryPreferenceService } from './dietary-preference.service';

describe('DietaryPreferenceService', () => {
  let repository: jest.Mocked<DietaryPreferenceRepository>;
  let profileService: jest.Mocked<UserProfileService>;
  let service: DietaryPreferenceService;

  beforeEach(() => {
    repository = createMock<DietaryPreferenceRepository>();
    repository.findOne.mockResolvedValue(null);
    repository.findAll.mockResolvedValue([]);
    profileService = createMock<UserProfileService>();
    profileService.getCurrent.mockResolvedValue(buildProfile());
    service = new DietaryPreferenceService(repository, profileService);
  });

  it('lists the profile preferences', async () => {
    const preferences = [buildPreference()];
    repository.findAll.mockResolvedValue(preferences);

    await expect(service.getAll()).resolves.toBe(preferences);
    expect(repository.findAll).toHaveBeenCalledWith(PROFILE_ID);
  });

  describe('add', () => {
    it('stores a normalized value', async () => {
      await service.add({ preferenceType: PreferenceType.Allergy, value: '  Peanut ' });

      expect(repository.findOne).toHaveBeenCalledWith(PROFILE_ID, {
        preferenceType: PreferenceType.Allergy,
        value: 'peanut',
      });
      expect(repository.create).toHaveBeenCalledWith(PROFILE_ID, {
        preferenceType: PreferenceType.Allergy,
        value: 'peanut',
      });
    });

    it('accepts a known diet', async () => {
      await service.add({ preferenceType: PreferenceType.Diet, value: DietTag.Vegan });

      expect(repository.create).toHaveBeenCalled();
    });

    it('rejects an unknown diet', async () => {
      await expect(
        service.add({ preferenceType: PreferenceType.Diet, value: 'carnivore' }),
      ).rejects.toBeInstanceOf(UnknownDietBadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it.each([
      [DietTag.Pescatarian, DietTag.Vegan],
      [DietTag.Vegetarian, DietTag.Pescatarian],
    ])('rejects %s next to a saved %s diet', async (diet, saved) => {
      repository.findAll.mockResolvedValue([
        buildPreference({ preferenceType: PreferenceType.Diet, value: saved }),
      ]);

      await expect(
        service.add({ preferenceType: PreferenceType.Diet, value: diet }),
      ).rejects.toThrow(new ConflictingDietsBadRequestException(diet, saved));
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('combines compatible diets', async () => {
      repository.findAll.mockResolvedValue([
        buildPreference({ preferenceType: PreferenceType.Diet, value: DietTag.Vegan }),
        buildPreference({ preferenceType: PreferenceType.Allergy, value: DietTag.Pescatarian }),
      ]);

      await service.add({ preferenceType: PreferenceType.Diet, value: DietTag.GlutenFree });

      expect(repository.create).toHaveBeenCalled();
    });

    it('stops at 50 preferences', async () => {
      repository.findAll.mockResolvedValue(Array.from({ length: 50 }, () => buildPreference()));

      await expect(
        service.add({ preferenceType: PreferenceType.Allergy, value: 'milk' }),
      ).rejects.toBeInstanceOf(TooManyPreferencesBadRequestException);
    });

    it('rejects a duplicate', async () => {
      repository.findOne.mockResolvedValue(buildPreference());

      await expect(
        service.add({ preferenceType: PreferenceType.Allergy, value: 'peanut' }),
      ).rejects.toBeInstanceOf(DietaryPreferenceExistsConflictException);
    });
  });

  describe('remove', () => {
    it('deletes a preference of the profile', async () => {
      const preference = buildPreference();
      repository.findById.mockResolvedValue(preference);

      await service.remove(preference.id);

      expect(repository.findById).toHaveBeenCalledWith(PROFILE_ID, preference.id);
      expect(repository.delete).toHaveBeenCalledWith(preference.id);
    });

    it('fails for an unknown id', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.remove('nope')).rejects.toBeInstanceOf(
        DietaryPreferenceNotFoundException,
      );
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });
});
