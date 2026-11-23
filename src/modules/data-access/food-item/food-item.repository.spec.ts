import { buildFoodItem, FOOD_ID } from '../../../test/fixtures';
import { createPrismaMock, PrismaMock } from '../../../test/prisma-mock';
import { FoodItemRepository } from './food-item.repository';
import { QueryMode, SortOrder } from '../../../common/constants';

describe('FoodItemRepository', () => {
  let prisma: PrismaMock;
  let repository: FoodItemRepository;

  beforeEach(() => {
    prisma = createPrismaMock();
    repository = new FoodItemRepository(prisma);
  });

  describe('findPage', () => {
    it('counts and pages in one transaction', async () => {
      const food = buildFoodItem();
      prisma.foodItem.count.mockResolvedValue(41 as never);
      prisma.foodItem.findMany.mockResolvedValue([food]);

      await expect(
        repository.findPage({}, { page: 3, limit: 20, sortOrder: SortOrder.Asc }),
      ).resolves.toEqual({
        items: [food],
        total: 41,
      });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.foodItem.findMany).toHaveBeenCalledWith({
        where: {},
        include: { translations: true },
        orderBy: [{ name: SortOrder.Asc }, { id: SortOrder.Asc }],
        skip: 40,
        take: 20,
      });
    });

    it('searches every word in both names and the translations case-insensitively and filters by state and source', async () => {
      await repository.findPage(
        { search: 'Boiled rice', state: 'boiled', source: 'seed' },
        { page: 1, limit: 10, sortOrder: SortOrder.Asc },
      );

      const where = {
        AND: ['boiled', 'rice'].map((word) => ({
          OR: [
            { name: { contains: word, mode: QueryMode.Insensitive } },
            { nameEn: { contains: word, mode: QueryMode.Insensitive } },
            { translations: { some: { name: { contains: word, mode: QueryMode.Insensitive } } } },
          ],
        })),
        state: 'boiled',
        source: 'seed',
      };
      expect(prisma.foodItem.count).toHaveBeenCalledWith({ where });
      expect(prisma.foodItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    });

    it('sorts by name and id in the requested order', async () => {
      await repository.findPage({}, { page: 1, limit: 20, sortOrder: SortOrder.Desc });

      expect(prisma.foodItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ name: SortOrder.Desc }, { id: SortOrder.Desc }] }),
      );
    });
  });

  it('finds by id', async () => {
    await repository.findById(FOOD_ID);

    expect(prisma.foodItem.findUnique).toHaveBeenCalledWith({
      where: { id: FOOD_ID },
      include: { translations: true },
    });
  });

  it('returns the foods that exist', async () => {
    const food = buildFoodItem();
    prisma.foodItem.findMany.mockResolvedValue([food]);

    await expect(repository.findByIds([FOOD_ID, 'b'])).resolves.toEqual([food]);
    expect(prisma.foodItem.findMany).toHaveBeenCalledWith({
      where: { id: { in: [FOOD_ID, 'b'] } },
    });
  });
});
