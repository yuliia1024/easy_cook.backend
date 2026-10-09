import { Repository } from 'typeorm';
import { Diet, Gender } from '../../../common/constants';
import { createMock } from '../../../test/create-mock';
import { buildProfile, USER_ID } from '../../../test/fixtures';
import { UserProfile } from './user-profile.entity';
import { UserProfileRepository } from './user-profile.repository';

describe('UserProfileRepository', () => {
  let repository: jest.Mocked<Repository<UserProfile>>;
  let profileRepository: UserProfileRepository;
  const data = { firstName: 'Jane', gender: Gender.Female, diet: Diet.Vegan };

  beforeEach(() => {
    repository = createMock<Repository<UserProfile>>();
    profileRepository = new UserProfileRepository(repository);
  });

  it('finds by user id', async () => {
    const profile = buildProfile();
    repository.findOneBy.mockResolvedValue(profile);

    await expect(profileRepository.findByUserId(USER_ID)).resolves.toBe(profile);
    expect(repository.findOneBy).toHaveBeenCalledWith({ userId: USER_ID });
  });

  it('upserts on userId and returns the stored row', async () => {
    const profile = buildProfile();
    repository.findOneByOrFail.mockResolvedValue(profile);

    await expect(profileRepository.upsert(USER_ID, data)).resolves.toBe(profile);
    expect(repository.upsert).toHaveBeenCalledWith(
      { userId: USER_ID, ...data },
      { conflictPaths: ['userId'] },
    );
    expect(repository.findOneByOrFail).toHaveBeenCalledWith({ userId: USER_ID });
  });

  it('updates by user id', async () => {
    await profileRepository.update(USER_ID, { diet: Diet.Keto });

    expect(repository.update).toHaveBeenCalledWith({ userId: USER_ID }, { diet: Diet.Keto });
  });
});
