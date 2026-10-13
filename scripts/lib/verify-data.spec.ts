import { Prisma } from '../../src/generated/prisma/client';
import { buildFoodItem } from '../../src/test/fixtures';
import { createPrismaMock, PrismaMock } from '../../src/test/prisma-mock';
import { ControlRecipe } from './control-recipes';
import {
  checkControlRecipes,
  checkDuplicateSources,
  checkForeignKeys,
  checkRecipesHaveIngredients,
  FOREIGN_KEYS,
  formatReport,
  summarize,
  verifyData,
} from './verify-data';

describe('verify data', () => {
  let prisma: PrismaMock;
  const sqlOf = (call: number): string => (prisma.$queryRaw.mock.calls[call][0] as Prisma.Sql).sql;

  /** 150 g of rice (365 / 7.1 / 0.7 / 80 per 100 g), 2 servings. */
  const recipe = {
    id: 'r1',
    servings: 2,
    ingredients: [
      {
        id: 'i1',
        quantityG: new Prisma.Decimal(150),
        isOptional: false,
        foodItem: buildFoodItem({
          kcalPer100g: new Prisma.Decimal(365),
          proteinG: new Prisma.Decimal(7.1),
          fatG: new Prisma.Decimal(0.7),
          carbsG: new Prisma.Decimal(80),
        }),
      },
    ],
  };
  const control: ControlRecipe = {
    slug: 'rice',
    servings: 2,
    calculation: ['150 g rice'],
    total: { kcal: 547.5, proteinG: 10.65, fatG: 1.05, carbsG: 120 },
    perServing: { kcal: 273.75, proteinG: 5.325, fatG: 0.525, carbsG: 60 },
  };

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.$queryRaw.mockResolvedValue([{ count: 0 }]);
  });

  describe('checkForeignKeys', () => {
    it('runs a LEFT JOIN per foreign key', async () => {
      const results = await checkForeignKeys(prisma);

      expect(results).toHaveLength(FOREIGN_KEYS.length);
      expect(results.every((r) => r.ok)).toBe(true);
      expect(results[0].name).toBe('fk recipe_ingredients.recipe_id -> recipes');
      expect(sqlOf(0)).toBe(
        'SELECT count(*)::int AS count FROM "recipe_ingredients" c ' +
          'LEFT JOIN "recipes" p ON p.id = c."recipe_id" ' +
          'WHERE c."recipe_id" IS NOT NULL AND p.id IS NULL',
      );
    });

    it('reports orphan rows', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ count: 3 }]);

      const [first] = await checkForeignKeys(prisma);

      expect(first).toMatchObject({ ok: false, detail: '3 orphan rows' });
    });
  });

  it('checkDuplicateSources groups by source and source id', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ count: 0 }]).mockResolvedValueOnce([{ count: 2 }]);

    const results = await checkDuplicateSources(prisma);

    expect(results).toEqual([
      { name: 'unique food_items (source, source_id)', ok: true, detail: 'ok' },
      { name: 'unique recipes (source, source_id)', ok: false, detail: '2 duplicated keys' },
    ]);
    expect(sqlOf(0)).toContain('GROUP BY source, source_id HAVING count(*) > 1');
  });

  it('checkRecipesHaveIngredients counts recipes without ingredients', async () => {
    prisma.$queryRaw.mockResolvedValue([{ count: 1 }]);

    await expect(checkRecipesHaveIngredients(prisma)).resolves.toEqual({
      name: 'recipes have ingredients',
      ok: false,
      detail: '1 recipes without ingredients',
    });
    expect(sqlOf(0)).toContain('NOT EXISTS');
  });

  describe('checkControlRecipes', () => {
    it('loads the seed recipe and compares the NutritionService result', async () => {
      prisma.recipe.findUnique.mockResolvedValue(recipe);

      const [result] = await checkControlRecipes(prisma, [control]);

      expect(result).toEqual({
        name: 'control rice',
        ok: true,
        detail: 'ok, per serving 273.8 kcal, P 5.3 g, F 0.5 g, C 60 g',
      });
      expect(prisma.recipe.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { source_sourceId: { source: 'seed', sourceId: 'rice' } },
        }),
      );
    });

    it('fails on different values and on unknown ones', async () => {
      const unknown = { ...recipe.ingredients[0].foodItem, fatG: null };
      prisma.recipe.findUnique.mockResolvedValue({
        ...recipe,
        ingredients: [{ ...recipe.ingredients[0], foodItem: unknown }],
      });

      const [result] = await checkControlRecipes(prisma, [control]);

      expect(result.ok).toBe(false);
      expect(result.detail).toBe(
        'total.fatG: expected 1.05, got 0; perServing.fatG: expected 0.525, got 0; ' +
          'a counted ingredient has an unknown value',
      );
    });

    it('fails when the recipe is not seeded', async () => {
      prisma.recipe.findUnique.mockResolvedValue(null);

      await expect(checkControlRecipes(prisma, [control])).resolves.toEqual([
        { name: 'control rice', ok: false, detail: 'recipe not found (run npm run db:seed)' },
      ]);
    });
  });

  it('summarize counts foods by source, recipes and ingredients', async () => {
    prisma.foodItem.groupBy.mockResolvedValue([
      { source: 'seed', _count: { _all: 45 } },
      { source: 'usda_fdc', _count: { _all: 300 } },
    ]);
    prisma.recipe.count.mockResolvedValue(12);
    prisma.recipeIngredient.count.mockResolvedValue(79);

    await expect(summarize(prisma)).resolves.toEqual({
      foodsBySource: { seed: 45, usda_fdc: 300 },
      recipes: 12,
      recipeIngredients: 79,
    });
  });

  describe('verifyData', () => {
    beforeEach(() => {
      prisma.recipe.findUnique.mockResolvedValue(recipe);
      prisma.foodItem.groupBy.mockResolvedValue([{ source: 'seed', _count: { _all: 1 } }]);
      prisma.recipe.count.mockResolvedValue(1);
      prisma.recipeIngredient.count.mockResolvedValue(1);
    });

    it('passes when every check passes', async () => {
      const report = await verifyData(prisma, [control]);

      expect(report.ok).toBe(true);
      expect(report.checks).toHaveLength(FOREIGN_KEYS.length + 2 + 1 + 1);
      expect(report.summary.recipes).toBe(1);
    });

    it('fails when one check fails', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ count: 1 }]);

      await expect(verifyData(prisma, [control])).resolves.toMatchObject({ ok: false });
    });
  });

  it('formatReport prints checks, counts and the verdict', () => {
    const lines = formatReport({
      ok: false,
      checks: [
        { name: 'a', ok: true, detail: 'ok' },
        { name: 'b', ok: false, detail: '1 orphan rows' },
      ],
      summary: { foodsBySource: { seed: 45, usda_fdc: 5 }, recipes: 12, recipeIngredients: 79 },
    });

    expect(lines).toEqual([
      'PASS  a: ok',
      'FAIL  b: 1 orphan rows',
      '',
      'foods: 50 (seed 45, usda_fdc 5)',
      'recipes: 12, ingredients: 79',
      '',
      'FAILED: 1 check(s)',
    ]);
  });
});
