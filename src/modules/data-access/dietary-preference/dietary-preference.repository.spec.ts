import { buildPreference, PROFILE_ID } from '../../../test/fixtures';
import { createPrismaMock, PrismaMock } from '../../../test/prisma-mock';
import { DietaryPreferenceRepository } from './dietary-preference.repository';
import { SortOrder } from '../../../common/constants';

describe('DietaryPreferenceRepository', () => {
  let prisma: PrismaMock;
  let repository: DietaryPreferenceRepository;
  const data = { preferenceType: 'allergy', value: 'peanut' };

  beforeEach(() => {
    prisma = createPrismaMock();
    repository = new DietaryPreferenceRepository(prisma);
  });

  it('lists the profile preferences grouped by type', async () => {
    await repository.findAll(PROFILE_ID);

    expect(prisma.dietaryPreference.findMany).toHaveBeenCalledWith({
      where: { profileId: PROFILE_ID },
      orderBy: [{ preferenceType: SortOrder.Asc }, { value: SortOrder.Asc }],
    });
  });

  it('finds by id within the profile', async () => {
    const preference = buildPreference();
    prisma.dietaryPreference.findFirst.mockResolvedValue(preference);

    await expect(repository.findById(PROFILE_ID, preference.id)).resolves.toBe(preference);
    expect(prisma.dietaryPreference.findFirst).toHaveBeenCalledWith({
      where: { id: preference.id, profileId: PROFILE_ID },
    });
  });

  it('finds by the unique type + value', async () => {
    await repository.findOne(PROFILE_ID, data);

    expect(prisma.dietaryPreference.findUnique).toHaveBeenCalledWith({
      where: { profileId_preferenceType_value: { profileId: PROFILE_ID, ...data } },
    });
  });

  it('creates and deletes', async () => {
    await repository.create(PROFILE_ID, data);
    await repository.delete('id-1');

    expect(prisma.dietaryPreference.create).toHaveBeenCalledWith({
      data: { profileId: PROFILE_ID, ...data },
    });
    expect(prisma.dietaryPreference.delete).toHaveBeenCalledWith({ where: { id: 'id-1' } });
  });
});
