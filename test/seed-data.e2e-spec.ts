import request from 'supertest';
import { foodCategoriesOf } from '../scripts/lib/classify-recipes';
import { compareNutrition, loadControlRecipes } from '../scripts/lib/control-recipes';
import { acceptedRecipes, loadSeedData, validateSeedData } from '../scripts/lib/seed-data';
import { upsertExternalFoods, upsertSeedFoods, upsertSeedRecipes } from '../scripts/lib/seed-db';
import { verifyData } from '../scripts/lib/verify-data';
import { createTestApp, resetDatabase, TestApp } from './test-app';
import { SortOrder } from '../src/common/constants';

/** `npm run db:seed` on an empty database, twice, then `data:verify` and the API. */
describe('seed data (e2e)', () => {
  let ctx: TestApp;
  const http = () => request(ctx.app.getHttpServer());
  const data = loadSeedData();
  const controls = loadControlRecipes();

  const seed = async () => ({
    foods: await upsertSeedFoods(ctx.prisma, data.foods),
    importedFoods: await upsertExternalFoods(ctx.prisma, data.importedFoods),
    recipes: await upsertSeedRecipes(ctx.prisma, data.recipes, foodCategoriesOf(data)),
  });
  const snapshot = async () => ({
    foods: await ctx.prisma.foodItem.findMany({
      select: { id: true, source: true, sourceId: true },
      orderBy: { id: SortOrder.Asc },
    }),
    recipes: await ctx.prisma.recipe.findMany({
      select: { id: true, source: true, sourceId: true },
      orderBy: { id: SortOrder.Asc },
    }),
    ingredients: await ctx.prisma.recipeIngredient.count(),
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('seeds an empty database, and a second run changes no counts or ids', async () => {
    const first = await seed();
    const before = await snapshot();
    const second = await seed();
    const after = await snapshot();

    expect(first).toEqual({
      foods: { created: data.foods.length, updated: 0 },
      importedFoods: data.importedFoods.length,
      recipes: { created: data.recipes.length, updated: 0 },
    });
    expect(second).toEqual({
      foods: { created: 0, updated: data.foods.length },
      importedFoods: data.importedFoods.length,
      recipes: { created: 0, updated: data.recipes.length },
    });
    expect(before.foods).toHaveLength(data.foods.length + data.importedFoods.length);
    expect(before.recipes).toHaveLength(data.recipes.length);
    expect(before.ingredients).toBe(data.recipes.reduce((n, r) => n + r.ingredients.length, 0));
    expect(after).toEqual(before);
  });

  it('passes data:verify', async () => {
    const report = await verifyData(ctx.prisma, controls);

    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.summary).toEqual({
      foodsBySource: { seed: data.foods.length, usda_fdc: data.importedFoods.length },
      recipes: data.recipes.length,
      recipeIngredients: expect.any(Number),
    });
  });

  it.each(controls.map((c) => [c.slug, c]))(
    'serves the hand-computed nutrition of control recipe %s',
    async (slug, control) => {
      const recipe = await ctx.prisma.recipe.findUniqueOrThrow({
        where: { source_sourceId: { source: 'seed', sourceId: slug } },
      });

      const { body } = await http().get(`/api/recipes/${recipe.id}/nutrition`).expect(200);

      expect(body).toMatchObject({
        servings: control.servings,
        includeOptional: false,
        complete: true,
      });
      expect(compareNutrition(control, body)).toEqual([]);
    },
  );

  it('does not import a recipe that breaks an import rule', async () => {
    const broken = { ...data.recipes[0], slug: 'broken-no-instructions', instructions: ' ' };
    const recipes = [...data.recipes, broken];
    const { errors, rejected } = validateSeedData({ ...data, recipes });

    expect(errors).toEqual([]);
    expect(rejected).toEqual([{ slug: 'broken-no-instructions', reasons: ['no instructions'] }]);

    await expect(
      upsertSeedRecipes(ctx.prisma, acceptedRecipes(recipes, rejected), foodCategoriesOf(data)),
    ).resolves.toEqual({ created: 0, updated: data.recipes.length });
    await expect(
      ctx.prisma.recipe.count({ where: { sourceId: 'broken-no-instructions' } }),
    ).resolves.toBe(0);
  });

  it('data:verify reports an imported recipe in the database that breaks a rule', async () => {
    const slug = data.recipes[0].slug;
    const where = { source_sourceId: { source: 'seed', sourceId: slug } };
    const { instructions } = await ctx.prisma.recipe.findUniqueOrThrow({ where });
    await ctx.prisma.recipe.update({ where, data: { instructions: '' } });

    try {
      const report = await verifyData(ctx.prisma, controls);

      expect(report.ok).toBe(false);
      expect(report.checks.filter((c) => !c.ok)).toEqual([
        {
          name: 'imported recipes pass the import rules',
          ok: false,
          detail: `1 recipes: ${slug} (no instructions)`,
        },
      ]);
    } finally {
      await ctx.prisma.recipe.update({ where, data: { instructions } });
    }
  });
});
