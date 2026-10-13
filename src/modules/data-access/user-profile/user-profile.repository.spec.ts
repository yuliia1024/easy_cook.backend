import { buildProfile, PROFILE_ID } from '../../../test/fixtures';
import { createPrismaMock, PrismaMock } from '../../../test/prisma-mock';
import { UserProfileRepository } from './user-profile.repository';
import { SortOrder } from '../../../common/constants';

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

  it('finds the oldest profile', async () => {
    const profile = buildProfile();
    prisma.userProfile.findFirst.mockResolvedValue(profile);

    await expect(repository.findCurrent()).resolves.toBe(profile);
    expect(prisma.userProfile.findFirst).toHaveBeenCalledWith({
      orderBy: { createdAt: SortOrder.Asc },
    });
  });

  it('creates', async () => {
    await repository.create(data);

    expect(prisma.userProfile.create).toHaveBeenCalledWith({ data });
  });

  it('updates by id', async () => {
    await repository.update(PROFILE_ID, { age: 31 });

    expect(prisma.userProfile.update).toHaveBeenCalledWith({
      where: { id: PROFILE_ID },
      data: { age: 31 },
    });
  });
});
