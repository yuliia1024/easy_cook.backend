import { buildFoodItem, FOOD_ID } from '../../../test/fixtures';
import { createPrismaMock, PrismaMock } from '../../../test/prisma-mock';
import { FoodItemRepository } from './food-item.repository';

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

      await expect(repository.findPage({}, { page: 3, limit: 20 })).resolves.toEqual({
        items: [food],
        total: 41,
      });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.foodItem.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: 40,
        take: 20,
      });
    });

    it('searches both names case-insensitively and filters by state and source', async () => {
      await repository.findPage(
        { search: 'rice', state: 'boiled', source: 'seed' },
        { page: 1, limit: 10 },
      );

      const where = {
        OR: [
          { name: { contains: 'rice', mode: 'insensitive' } },
          { nameEn: { contains: 'rice', mode: 'insensitive' } },
        ],
        state: 'boiled',
        source: 'seed',
      };
      expect(prisma.foodItem.count).toHaveBeenCalledWith({ where });
      expect(prisma.foodItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    });
  });

  it('finds by id', async () => {
    await repository.findById(FOOD_ID);

    expect(prisma.foodItem.findUnique).toHaveBeenCalledWith({ where: { id: FOOD_ID } });
  });

  it('returns the ids that exist', async () => {
    prisma.foodItem.findMany.mockResolvedValue([{ id: 'a' }] as never);

    await expect(repository.findExistingIds(['a', 'b'])).resolves.toEqual(['a']);
    expect(prisma.foodItem.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] } },
      select: { id: true },
    });
  });

  it('finds by the unique source + source id', async () => {
    await repository.findBySource('usda_fdc', '123');

    expect(prisma.foodItem.findUnique).toHaveBeenCalledWith({
      where: { source_sourceId: { source: 'usda_fdc', sourceId: '123' } },
    });
  });

  it('creates and updates', async () => {
    const data = { name: 'Rice', state: 'raw', source: 'manual', kcalPer100g: 360 };

    await repository.create(data);
    await repository.update(FOOD_ID, { kcalPer100g: null });

    expect(prisma.foodItem.create).toHaveBeenCalledWith({ data });
    expect(prisma.foodItem.update).toHaveBeenCalledWith({
      where: { id: FOOD_ID },
      data: { kcalPer100g: null },
    });
  });
});
