import { FoodCategory } from '../../src/common/constants';
import { createPrismaMock, PrismaMock } from '../../src/test/prisma-mock';
import { SeedFood, SeedRecipe } from './seed-data';
import {
  resolveFoodRefs,
  upsertExternalFoods,
  upsertSeedFoods,
  upsertSeedRecipes,
} from './seed-db';

describe('seed db', () => {
  let prisma: PrismaMock;
  const food: SeedFood = {
    slug: 'rice-white-dry',
    name: 'Rice',
    state: 'dried',
    kcalPer100g: 365,
    proteinG: 7.1,
    fatG: 0.7,
    carbsG: 80,
  };
  const recipe: SeedRecipe = {
    slug: 'rice',
    name: 'Rice',
    instructions: 'Boil',
    mealType: 'lunch',
    dietType: ['vegetarian', 'high_protein'],
    servings: 2,
    ingredients: [
      { food: 'rice-white-dry', quantityG: 150 },
      { food: 'usda_fdc:42', quantityG: 5, isOptional: true, notes: 'to taste' },
    ],
  };

  const categoriesOf = new Map([
    ['rice-white-dry', [FoodCategory.Grain]],
    ['usda_fdc:42', [FoodCategory.HerbSpice]],
  ]);

  beforeEach(() => {
    prisma = createPrismaMock();
  });

  describe('upsertSeedFoods', () => {
    it('creates a new food under the seed source', async () => {
      prisma.foodItem.findUnique.mockResolvedValue(null);

      await expect(upsertSeedFoods(prisma, [food])).resolves.toEqual({ created: 1, updated: 0 });
      const { slug: _slug, ...data } = food;
      expect(prisma.foodItem.create).toHaveBeenCalledWith({
        data: { ...data, nameEn: null, source: 'seed', sourceId: 'rice-white-dry' },
      });
    });

    it('updates an existing one in place', async () => {
      prisma.foodItem.findUnique.mockResolvedValue({ id: 'f1' });

      await expect(upsertSeedFoods(prisma, [food])).resolves.toEqual({ created: 0, updated: 1 });
      expect(prisma.foodItem.update).toHaveBeenCalledWith({
        where: { id: 'f1' },
        data: expect.objectContaining({ name: 'Rice', kcalPer100g: 365 }),
      });
    });
  });

  describe('resolveFoodRefs', () => {
    it('maps every reference to a food id', async () => {
      prisma.foodItem.findUnique
        .mockResolvedValueOnce({ id: 'seed-id' })
        .mockResolvedValueOnce({ id: 'usda-id' });

      const ids = await resolveFoodRefs(prisma, [recipe]);

      expect(ids).toEqual(
        new Map([
          ['rice-white-dry', 'seed-id'],
          ['usda_fdc:42', 'usda-id'],
        ]),
      );
      expect(prisma.foodItem.findUnique).toHaveBeenCalledWith({
        where: { source_sourceId: { source: 'usda_fdc', sourceId: '42' } },
        select: { id: true },
      });
    });

    it('lists every missing reference', async () => {
      prisma.foodItem.findUnique.mockResolvedValue(null);

      await expect(resolveFoodRefs(prisma, [recipe])).rejects.toThrow(
        'Foods not found (seed the foods / import USDA data first): rice-white-dry, usda_fdc:42',
      );
    });
  });

  describe('upsertSeedRecipes', () => {
    beforeEach(() => {
      prisma.foodItem.findUnique
        .mockResolvedValueOnce({ id: 'seed-id' })
        .mockResolvedValueOnce({ id: 'usda-id' });
    });

    const rows = [
      { foodItemId: 'seed-id', quantityG: 150, isOptional: false, notes: null, position: 0 },
      { foodItemId: 'usda-id', quantityG: 5, isOptional: true, notes: 'to taste', position: 1 },
    ];

    it('creates a new recipe with ordered ingredients and the derived diet tags', async () => {
      prisma.recipe.findUnique.mockResolvedValue(null);

      await expect(upsertSeedRecipes(prisma, [recipe], categoriesOf)).resolves.toEqual({
        created: 1,
        updated: 0,
      });
      expect(prisma.recipe.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Rice',
          dietType: ['vegan', 'gluten_free', 'dairy_free', 'high_protein'],
          allergens: [],
          description: null,
          prepTimeMinutes: null,
          source: 'seed',
          sourceId: 'rice',
          ingredients: { create: rows },
        }),
      });
    });

    it('replaces the ingredients of an existing recipe', async () => {
      prisma.recipe.findUnique.mockResolvedValue({ id: 'r1' });

      await expect(upsertSeedRecipes(prisma, [recipe], categoriesOf)).resolves.toEqual({
        created: 0,
        updated: 1,
      });
      expect(prisma.recipeIngredient.deleteMany).toHaveBeenCalledWith({
        where: { recipeId: 'r1' },
      });
      expect(prisma.recipe.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: expect.objectContaining({ ingredients: { create: rows } }),
      });
    });
  });

  describe('upsertExternalFoods', () => {
    const food = (sourceId: string) => ({
      name: 'Apples, raw',
      nameEn: 'Apples, raw',
      kcalPer100g: 52,
      proteinG: 0.3,
      fatG: 0.2,
      carbsG: 13.8,
      state: 'raw',
      source: 'usda_fdc',
      sourceId,
    });

    it('upserts by source + source id in batches', async () => {
      const foods = ['1', '2', '3'].map(food);

      await expect(upsertExternalFoods(prisma, foods, 2)).resolves.toBe(3);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(prisma.foodItem.upsert).toHaveBeenCalledTimes(3);
      expect(prisma.foodItem.upsert).toHaveBeenCalledWith({
        where: { source_sourceId: { source: 'usda_fdc', sourceId: '1' } },
        create: foods[0],
        update: foods[0],
      });
    });

    it('does nothing for an empty list', async () => {
      await expect(upsertExternalFoods(prisma, [])).resolves.toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
