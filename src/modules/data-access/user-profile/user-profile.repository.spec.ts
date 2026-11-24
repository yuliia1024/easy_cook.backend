import { buildProfile, PROFILE_ID, USER_ID } from '../../../test/fixtures';
import { createPrismaMock, PrismaMock } from '../../../test/prisma-mock';
import { UserProfileRepository } from './user-profile.repository';

describe('UserProfileRepository', () => {
  let prisma: PrismaMock;
  let repository: UserProfileRepository;
  const data = {
    age: 30,
    heightCm: 170,
    weightKg: 65,
    sex: 'female',
    activityLevel: 'moderate',
    goal: 'maintain',
  };

  beforeEach(() => {
    prisma = createPrismaMock();
    repository = new UserProfileRepository(prisma);
  });

  it('finds the profile of the user', async () => {
    const profile = buildProfile();
    prisma.userProfile.findUnique.mockResolvedValue(profile);

    await expect(repository.findByUserId(USER_ID)).resolves.toBe(profile);
    expect(prisma.userProfile.findUnique).toHaveBeenCalledWith({ where: { userId: USER_ID } });
  });

  it('creates or replaces the profile of the user', async () => {
    await repository.upsert(USER_ID, data);

    expect(prisma.userProfile.upsert).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      create: { ...data, userId: USER_ID },
      update: data,
    });
  });

  it('updates by id', async () => {
    await repository.update(PROFILE_ID, { age: 31 });

    expect(prisma.userProfile.update).toHaveBeenCalledWith({
      where: { id: PROFILE_ID },
      data: { age: 31 },
    });
  });
});
