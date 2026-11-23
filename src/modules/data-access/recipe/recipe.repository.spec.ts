import { buildRecipe, RECIPE_ID } from '../../../test/fixtures';
import { createPrismaMock, PrismaMock } from '../../../test/prisma-mock';
import { RECIPE_INCLUDE, RecipeRepository } from './recipe.repository';
import { QueryMode, SortOrder } from '../../../common/constants';

describe('RecipeRepository', () => {
  let prisma: PrismaMock;
  let repository: RecipeRepository;

  beforeEach(() => {
    prisma = createPrismaMock();
    repository = new RecipeRepository(prisma);
  });

  it('orders ingredients by position and loads their food and every translation', () => {
    expect(RECIPE_INCLUDE).toEqual({
      ingredients: {
        include: { foodItem: { include: { translations: true } }, translations: true },
        orderBy: [{ position: SortOrder.Asc }, { id: SortOrder.Asc }],
      },
      translations: true,
    });
  });

  describe('findByIds', () => {
    it('loads the recipes with their ingredients', async () => {
      const recipe = buildRecipe();
      prisma.recipe.findMany.mockResolvedValue([recipe]);

      await expect(repository.findByIds([RECIPE_ID])).resolves.toEqual([recipe]);
      expect(prisma.recipe.findMany).toHaveBeenCalledWith({
        where: { id: { in: [RECIPE_ID] } },
        include: RECIPE_INCLUDE,
      });
    });

    it('makes no query for no ids', async () => {
      await expect(repository.findByIds([])).resolves.toEqual([]);
      expect(prisma.recipe.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findPage', () => {
    it('counts and pages with ingredients', async () => {
      const recipe = buildRecipe();
      prisma.recipe.count.mockResolvedValue(3 as never);
      prisma.recipe.findMany.mockResolvedValue([recipe]);

      await expect(
        repository.findPage({}, { page: 2, limit: 2, sortOrder: SortOrder.Asc }),
      ).resolves.toEqual({
        items: [recipe],
        total: 3,
      });
      expect(prisma.recipe.findMany).toHaveBeenCalledWith({
        where: {},
        include: RECIPE_INCLUDE,
        orderBy: [{ name: SortOrder.Asc }, { id: SortOrder.Asc }],
        skip: 2,
        take: 2,
      });
    });

    it('filters by name or translated name, meal type and every given diet tag', async () => {
      await repository.findPage(
        { search: 'soup', mealType: 'lunch', dietTypes: ['vegan', 'gluten_free'] },
        { page: 1, limit: 20, sortOrder: SortOrder.Asc },
      );

      expect(prisma.recipe.count).toHaveBeenCalledWith({
        where: {
          OR: [
            { name: { contains: 'soup', mode: QueryMode.Insensitive } },
            {
              translations: {
                some: { name: { contains: 'soup', mode: QueryMode.Insensitive } },
              },
            },
          ],
          mealType: 'lunch',
          dietType: { hasEvery: ['vegan', 'gluten_free'] },
        },
      });
    });

    it('needs one tag of each diet tag group', async () => {
      await repository.findPage(
        { dietTypeGroups: [['vegetarian', 'vegan'], ['gluten_free']] },
        { page: 1, limit: 20, sortOrder: SortOrder.Asc },
      );

      expect(prisma.recipe.count).toHaveBeenCalledWith({
        where: {
          AND: [
            { dietType: { hasSome: ['vegetarian', 'vegan'] } },
            { dietType: { hasSome: ['gluten_free'] } },
          ],
        },
      });
    });

    it('ignores empty diet tag lists', async () => {
      await repository.findPage(
        { dietTypes: [], dietTypeGroups: [] },
        { page: 1, limit: 20, sortOrder: SortOrder.Asc },
      );

      expect(prisma.recipe.count).toHaveBeenCalledWith({ where: {} });
    });

    it('sorts by name and id in the requested order', async () => {
      await repository.findPage({}, { page: 1, limit: 20, sortOrder: SortOrder.Desc });

      expect(prisma.recipe.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ name: SortOrder.Desc }, { id: SortOrder.Desc }] }),
      );
    });
  });

  it('finds every matching recipe, unpaged, by name', async () => {
    const recipe = buildRecipe();
    prisma.recipe.findMany.mockResolvedValue([recipe]);

    await expect(repository.findAll({ dietTypes: ['vegan'] })).resolves.toEqual([recipe]);
    expect(prisma.recipe.findMany).toHaveBeenCalledWith({
      where: { dietType: { hasEvery: ['vegan'] } },
      include: RECIPE_INCLUDE,
      orderBy: [{ name: SortOrder.Asc }, { id: SortOrder.Asc }],
    });
  });

  it('finds by id with ingredients', async () => {
    await repository.findById(RECIPE_ID);

    expect(prisma.recipe.findUnique).toHaveBeenCalledWith({
      where: { id: RECIPE_ID },
      include: RECIPE_INCLUDE,
    });
  });
});
