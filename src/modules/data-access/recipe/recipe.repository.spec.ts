import { buildRecipe, FOOD_ID, RECIPE_ID } from '../../../test/fixtures';
import { createPrismaMock, PrismaMock } from '../../../test/prisma-mock';
import { RECIPE_INCLUDE, RecipeRepository } from './recipe.repository';
import { QueryMode, SortOrder } from '../../../common/constants';

describe('RecipeRepository', () => {
  let prisma: PrismaMock;
  let repository: RecipeRepository;
  const data = {
    name: 'Soup',
    instructions: 'Cook',
    mealType: 'lunch',
    servings: 2,
    source: 'manual',
  };
  const ingredients = [
    { foodItemId: FOOD_ID, quantityG: 100 },
    { foodItemId: 'other', quantityG: 5, isOptional: true },
  ];

  beforeEach(() => {
    prisma = createPrismaMock();
    repository = new RecipeRepository(prisma);
  });

  it('orders ingredients by position and loads their food', () => {
    expect(RECIPE_INCLUDE.ingredients).toEqual({
      include: { foodItem: true },
      orderBy: [{ position: SortOrder.Asc }, { id: SortOrder.Asc }],
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

    it('filters by name, meal type and every given diet tag', async () => {
      await repository.findPage(
        { search: 'soup', mealType: 'lunch', dietTypes: ['vegan', 'gluten_free'] },
        { page: 1, limit: 20, sortOrder: SortOrder.Asc },
      );

      expect(prisma.recipe.count).toHaveBeenCalledWith({
        where: {
          name: { contains: 'soup', mode: QueryMode.Insensitive },
          mealType: 'lunch',
          dietType: { hasEvery: ['vegan', 'gluten_free'] },
        },
      });
    });

    it('ignores an empty diet tag list', async () => {
      await repository.findPage(
        { dietTypes: [] },
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

  it('finds by id with ingredients', async () => {
    await repository.findById(RECIPE_ID);

    expect(prisma.recipe.findUnique).toHaveBeenCalledWith({
      where: { id: RECIPE_ID },
      include: RECIPE_INCLUDE,
    });
  });

  it('finds by the unique source + source id', async () => {
    await repository.findBySource('seed', 'soup');

    expect(prisma.recipe.findUnique).toHaveBeenCalledWith({
      where: { source_sourceId: { source: 'seed', sourceId: 'soup' } },
      select: { id: true },
    });
  });

  it('creates the recipe with numbered ingredients', async () => {
    await repository.create(data, ingredients);

    expect(prisma.recipe.create).toHaveBeenCalledWith({
      data: {
        ...data,
        ingredients: {
          create: [
            { foodItemId: FOOD_ID, quantityG: 100, position: 0 },
            { foodItemId: 'other', quantityG: 5, isOptional: true, position: 1 },
          ],
        },
      },
      include: RECIPE_INCLUDE,
    });
  });

  describe('update', () => {
    it('changes only fields when no ingredients are given', async () => {
      await repository.update(RECIPE_ID, { name: 'New' });

      expect(prisma.recipeIngredient.deleteMany).not.toHaveBeenCalled();
      expect(prisma.recipe.update).toHaveBeenCalledWith({
        where: { id: RECIPE_ID },
        data: { name: 'New' },
        include: RECIPE_INCLUDE,
      });
    });

    it('replaces the ingredient list in a transaction', async () => {
      await repository.update(RECIPE_ID, {}, [ingredients[0]]);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.recipeIngredient.deleteMany).toHaveBeenCalledWith({
        where: { recipeId: RECIPE_ID },
      });
      expect(prisma.recipe.update).toHaveBeenCalledWith({
        where: { id: RECIPE_ID },
        data: { ingredients: { create: [{ ...ingredients[0], position: 0 }] } },
        include: RECIPE_INCLUDE,
      });
    });
  });

  it('deletes', async () => {
    await repository.delete(RECIPE_ID);

    expect(prisma.recipe.delete).toHaveBeenCalledWith({ where: { id: RECIPE_ID } });
  });
});
