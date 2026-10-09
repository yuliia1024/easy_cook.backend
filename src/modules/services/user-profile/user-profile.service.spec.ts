import { Diet, Gender } from '../../../common/constants';
import { ProfileNotFoundException } from '../../../common/exceptions';
import { createMock } from '../../../test/create-mock';
import { buildProfile, USER_ID } from '../../../test/fixtures';
import { UserProfileRepository } from '../../data-access/user-profile/user-profile.repository';
import { UserProfileService } from './user-profile.service';

describe('UserProfileService', () => {
  let repository: jest.Mocked<UserProfileRepository>;
  let service: UserProfileService;

  beforeEach(() => {
    repository = createMock<UserProfileRepository>();
    service = new UserProfileService(repository);
  });

  it('saves the questionnaire with a trimmed name', async () => {
    const profile = buildProfile();
    repository.upsert.mockResolvedValue(profile);

    await expect(
      service.save(USER_ID, { firstName: '  Jane ', gender: Gender.Female, diet: Diet.Vegan }),
    ).resolves.toBe(profile);
    expect(repository.upsert).toHaveBeenCalledWith(USER_ID, {
      firstName: 'Jane',
      gender: Gender.Female,
      diet: Diet.Vegan,
    });
  });

  describe('update', () => {
    it('changes only the given fields', async () => {
      const updated = buildProfile({ diet: Diet.Keto });
      repository.findByUserId.mockResolvedValueOnce(buildProfile()).mockResolvedValueOnce(updated);

      await expect(service.update(USER_ID, { diet: Diet.Keto })).resolves.toBe(updated);
      expect(repository.update).toHaveBeenCalledWith(USER_ID, { diet: Diet.Keto });
    });

    it('trims a changed name', async () => {
      repository.findByUserId.mockResolvedValue(buildProfile());

      await service.update(USER_ID, { firstName: ' Ann ' });

      expect(repository.update).toHaveBeenCalledWith(USER_ID, { firstName: 'Ann' });
    });

    it('requires the questionnaire to be filled in first', async () => {
      repository.findByUserId.mockResolvedValue(null);

      await expect(service.update(USER_ID, { diet: Diet.Keto })).rejects.toBeInstanceOf(
        ProfileNotFoundException,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });
  });
});
