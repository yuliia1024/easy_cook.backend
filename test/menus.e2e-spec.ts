import request from 'supertest';
import { createMenuWorld, MenuWorld } from './menu-fixtures';
import { createTestApp, resetDatabase, TestApp } from './test-app';

describe('/api/menus (e2e)', () => {
  let ctx: TestApp;
  let world: MenuWorld;
  const http = () => request(ctx.app.getHttpServer());

  const manual = () => ({
    title: 'My week',
    notes: 'by hand',
    days: [
      {
        dayIndex: 0,
        date: '2026-10-20',
        meals: [
          { mealType: 'breakfast', recipeId: world.recipe.oats, servings: 1 },
          { mealType: 'lunch', recipeId: world.recipe.chicken, servings: 1.5 },
          { mealType: 'dinner', recipeId: world.recipe.bowl, servings: 1 },
        ],
      },
    ],
  });
  const addPreference = (preferenceType: string, value: string) =>
    http().post('/api/preferences').send({ preferenceType, value }).expect(201);

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    world = await createMenuWorld(ctx);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('POST /menus', () => {
    it('saves version 1 with snapshots, nutrition per meal and day, and warnings', async () => {
      const { body } = await http().post('/api/menus').send(manual()).expect(201);

      expect(body).toMatchObject({ title: 'My week', confirmedVersionId: null });
      const [version] = body.versions;
      expect(version).toMatchObject({
        versionNumber: 1,
        generatedBy: 'manual',
        notes: 'by hand',
        isConfirmed: false,
        nutritionGoal: { caloriesKcal: 2172, calculationMode: 'rule_based' },
      });
      // 444 + 1.5 × 655 + 520 = 1946.5 kcal: within 15 % of 2172.
      expect(version.days[0]).toMatchObject({
        dayIndex: 0,
        date: '2026-10-20',
        totals: { kcal: 1946.5 },
        complete: true,
      });
      expect(version.days[0].meals[1]).toMatchObject({
        mealType: 'lunch',
        position: 1,
        recipeId: world.recipe.chicken,
        servings: 1.5,
        nutrition: { kcal: 982.5 },
        recipe: { name: 'Chicken with rice', perServing: { kcal: 655 } },
      });
      expect(version.issues).toEqual([]);

      const list = await http().get('/api/menus').expect(200);
      expect(list.body).toEqual([expect.objectContaining({ id: body.id, versionCount: 1 })]);
    });

    it('warns about a day far from the goal', async () => {
      const { body } = await http()
        .post('/api/menus')
        .send({ ...manual(), days: [{ dayIndex: 0, meals: [manual().days[0].meals[0]] }] })
        .expect(201);

      expect(body.versions[0].issues).toEqual([
        expect.objectContaining({ severity: 'warning', code: 'calories_off_target', dayIndex: 0 }),
      ]);
    });

    it('rejects unknown recipes, duplicate days and broken preferences', async () => {
      const missing = '2b1e7f3a-5d47-4a8e-9f6c-1d2e3f4a5b6c';
      const unknown = manual();
      unknown.days[0].meals[0].recipeId = missing;
      const res = await http().post('/api/menus').send(unknown).expect(400);
      expect(res.body.message).toBe(`Recipes not found: ${missing}`);

      const twice = manual();
      twice.days.push({ ...twice.days[0] });
      await http().post('/api/menus').send(twice).expect(400);

      await addPreference('diet', 'vegan');
      const { body } = await http().post('/api/menus').send(manual()).expect(400);
      expect(body.message).toBe(
        'The menu breaks the profile rules: Day 1, lunch: Chicken with rice is not vegan',
      );
      expect(await ctx.prisma.menu.count()).toBe(0);
    });

    it('validates the body', async () => {
      await http()
        .post('/api/menus')
        .send({ ...manual(), days: [] })
        .expect(400);
      await http()
        .post('/api/menus')
        .send({ ...manual(), extra: true })
        .expect(400);
    });
  });

  describe('POST /menus/generate', () => {
    it('plans the requested days with the stub planner', async () => {
      const { body } = await http()
        .post('/api/menus/generate')
        .send({ days: 3, startDate: '2026-10-20' })
        .expect(201);

      expect(body.title).toBe('Menu for 3 days');
      const [version] = body.versions;
      expect(version.generatedBy).toBe('stub');
      expect(version.days.map((day: { date: string }) => day.date)).toEqual([
        '2026-10-20',
        '2026-10-21',
        '2026-10-22',
      ]);
      for (const day of version.days) {
        expect(day.meals.map((meal: { mealType: string }) => meal.mealType)).toEqual([
          'breakfast',
          'lunch',
          'dinner',
        ]);
      }
    });

    it('follows the allergies', async () => {
      await addPreference('allergy', 'peanut');

      const { body } = await http().post('/api/menus/generate').send({ days: 4 }).expect(201);

      const recipes = body.versions[0].days.flatMap((day: { meals: { recipeId: string }[] }) =>
        day.meals.map((meal) => meal.recipeId),
      );
      expect(recipes).not.toContain(world.recipe.satay);
    });

    it('needs a goal and recipes for every meal', async () => {
      await http()
        .post('/api/menus/generate')
        .send({ days: 1, mealTypes: ['snack'] })
        .expect(422);

      await addPreference('diet', 'vegan');
      const { body } = await http().post('/api/menus/generate').send({ days: 1 }).expect(422);
      expect(body.message).toBe('No lunch recipes match the dietary preferences');

      await resetDatabase(ctx.prisma);
      await createMenuWorld(ctx, { goal: false });
      await http().post('/api/menus/generate').send({ days: 1 }).expect(404);
    });
  });

  describe('versions', () => {
    let menuId: string;

    beforeEach(async () => {
      menuId = (await http().post('/api/menus').send(manual()).expect(201)).body.id;
    });

    it('adds manual versions, replaces meals and confirms one explicitly', async () => {
      const edited = manual();
      edited.days[0].meals[2].recipeId = world.recipe.satay;
      await http().post(`/api/menus/${menuId}/versions`).send({ days: edited.days }).expect(201);

      const replaced = await http()
        .post(`/api/menus/${menuId}/replace-meal`)
        .send({ dayIndex: 0, position: 2 })
        .expect(201);
      const [latest, second, first] = replaced.body.versions;
      expect([latest.versionNumber, second.versionNumber, first.versionNumber]).toEqual([3, 2, 1]);
      expect(second.days[0].meals[2].recipeId).toBe(world.recipe.satay);
      expect(latest.days[0].meals[2].recipeId).toBe(world.recipe.bowl);
      expect(latest.generatedBy).toBe('stub');
      expect(latest.days[0].meals[0].recipeId).toBe(world.recipe.oats);

      const confirmed = await http()
        .post(`/api/menus/${menuId}/versions/${second.id}/confirm`)
        .expect(200);
      expect(confirmed.body.confirmedVersionId).toBe(second.id);
      expect(confirmed.body.confirmedAt).toEqual(expect.any(String));
      expect(confirmed.body.versions[1].isConfirmed).toBe(true);
    });

    it('refuses to confirm a version that breaks the current preferences', async () => {
      const { body } = await http().get(`/api/menus/${menuId}`).expect(200);
      await addPreference('excluded_ingredient', 'chicken');

      const res = await http()
        .post(`/api/menus/${menuId}/versions/${body.versions[0].id}/confirm`)
        .expect(400);
      expect(res.body.message).toContain('Chicken with rice contains Chicken breast, cooked');
    });

    it('fixes a menu meal by meal after the preferences change', async () => {
      await addPreference('diet', 'vegan');

      const { body } = await http()
        .post(`/api/menus/${menuId}/replace-meal`)
        .send({ dayIndex: 0, position: 0 })
        .expect(422);
      expect(body.message).toBe('No breakfast recipes match the dietary preferences');

      // The lunch can only be replaced by a vegan lunch, and there is none.
      await http()
        .post(`/api/menus/${menuId}/replace-meal`)
        .send({ dayIndex: 0, position: 1 })
        .expect(422);
    });

    it('keeps the snapshot of a deleted recipe and still builds new versions', async () => {
      await http().delete(`/api/recipes/${world.recipe.oats}`).expect(204);

      const { body } = await http().get(`/api/menus/${menuId}`).expect(200);
      expect(body.versions[0].days[0].meals[0]).toMatchObject({
        recipeId: null,
        recipe: { name: 'Oatmeal' },
        nutrition: { kcal: 444 },
      });

      const replaced = await http()
        .post(`/api/menus/${menuId}/replace-meal`)
        .send({ dayIndex: 0, position: 2 })
        .expect(201);
      expect(replaced.body.versions[0].days[0].meals[0]).toMatchObject({
        recipeId: null,
        recipe: { name: 'Oatmeal' },
      });
    });

    it('404s for unknown meals, versions and menus', async () => {
      await http()
        .post(`/api/menus/${menuId}/replace-meal`)
        .send({ dayIndex: 5, position: 0 })
        .expect(404);
      await http()
        .post(`/api/menus/${menuId}/versions/2b1e7f3a-5d47-4a8e-9f6c-1d2e3f4a5b6c/confirm`)
        .expect(404);
      await http()
        .post('/api/menus/2b1e7f3a-5d47-4a8e-9f6c-1d2e3f4a5b6c/versions')
        .send({ days: manual().days })
        .expect(404);
    });

    it('renames and deletes', async () => {
      const renamed = await http()
        .patch(`/api/menus/${menuId}`)
        .send({ title: 'Renamed' })
        .expect(200);
      expect(renamed.body.title).toBe('Renamed');

      await http().delete(`/api/menus/${menuId}`).expect(204);
      await http().get(`/api/menus/${menuId}`).expect(404);
      expect(await ctx.prisma.menuMeal.count()).toBe(0);
    });
  });
});
