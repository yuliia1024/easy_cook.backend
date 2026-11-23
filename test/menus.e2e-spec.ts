import { createMenuWorld, MenuDayBody, MenuWorld, seedMenu, seedVersion } from './menu-fixtures';
import { createTestApp, resetDatabase, TestApp } from './test-app';

describe('/api/menus (e2e)', () => {
  let ctx: TestApp;
  let world: MenuWorld;
  let menuId: string;
  const http = () => ctx.http();
  const UNKNOWN_ID = '2b1e7f3a-5d47-4a8e-9f6c-1d2e3f4a5b6c';

  const days = (): MenuDayBody[] => [
    {
      dayIndex: 0,
      date: '2026-10-20',
      meals: [
        { mealType: 'breakfast', recipeId: world.recipe.oats, servings: 1 },
        { mealType: 'lunch', recipeId: world.recipe.chicken, servings: 1.5 },
        { mealType: 'dinner', recipeId: world.recipe.bowl, servings: 1 },
      ],
    },
  ];
  const addPreference = (preferenceType: string, value: string) =>
    http().post('/api/preferences').send({ preferenceType, value }).expect(201);

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    world = await createMenuWorld(ctx);
    menuId = await seedMenu(ctx, 'My week', days(), 'seeded');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('cannot create menus or add versions', async () => {
    await http().post('/api/menus').send({ title: 'My week', days: days() }).expect(404);
    await http().post('/api/menus/generate').send({ days: 3 }).expect(404);
    await http().post(`/api/menus/${menuId}/versions`).send({ days: days() }).expect(404);
    await http()
      .post(`/api/menus/${menuId}/replace-meal`)
      .send({ dayIndex: 0, position: 2 })
      .expect(404);

    expect(await ctx.prisma.menu.count()).toBe(1);
    expect(await ctx.prisma.menuVersion.count()).toBe(1);
  });

  it('lists the menus with their version count, only confirmed ones unless asked for drafts', async () => {
    await seedVersion(ctx, menuId, days());
    const listed = [expect.objectContaining({ id: menuId, title: 'My week', versionCount: 2 })];

    await http().get('/api/menus').expect(200, []);
    await http().get('/api/menus?status=confirmed').expect(200, []);
    expect((await http().get('/api/menus?status=draft').expect(200)).body).toEqual(listed);
    expect((await http().get('/api/menus?status=all').expect(200)).body).toEqual(listed);
    await http().get('/api/menus?status=pending').expect(400);

    const { body: menu } = await http().get(`/api/menus/${menuId}`).expect(200);
    await http().post(`/api/menus/${menuId}/versions/${menu.versions[0].id}/confirm`).expect(200);
    expect((await http().get('/api/menus').expect(200)).body).toEqual(listed);
    await http().get('/api/menus?status=draft').expect(200, []);
  });

  it('returns a menu with snapshots and nutrition per meal and day', async () => {
    const { body } = await http().get(`/api/menus/${menuId}`).expect(200);

    expect(body).toMatchObject({ title: 'My week', confirmedVersionId: null });
    const [version] = body.versions;
    expect(version).toMatchObject({
      versionNumber: 1,
      generatedBy: 'manual',
      notes: 'seeded',
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
  });

  it('confirms any version explicitly', async () => {
    const edited = days();
    edited[0].meals[2].recipeId = world.recipe.satay;
    await seedVersion(ctx, menuId, edited);

    const { body } = await http().get(`/api/menus/${menuId}`).expect(200);
    const [latest, first] = body.versions;
    expect([latest.versionNumber, first.versionNumber]).toEqual([2, 1]);
    expect(latest.days[0].meals[2].recipeId).toBe(world.recipe.satay);

    const confirmed = await http()
      .post(`/api/menus/${menuId}/versions/${first.id}/confirm`)
      .expect(200);
    expect(confirmed.body.confirmedVersionId).toBe(first.id);
    expect(confirmed.body.confirmedAt).toEqual(expect.any(String));
    expect(confirmed.body.versions[1].isConfirmed).toBe(true);
    expect(confirmed.body.versions[0].isConfirmed).toBe(false);
  });

  it('refuses to confirm a version that breaks the current preferences', async () => {
    const { body } = await http().get(`/api/menus/${menuId}`).expect(200);
    await addPreference('excluded_ingredient', 'chicken');

    const res = await http()
      .post(`/api/menus/${menuId}/versions/${body.versions[0].id}/confirm`)
      .expect(400);
    expect(res.body.message).toContain('Chicken with rice contains Chicken breast, cooked');
  });

  it('lets vegan meals through a vegetarian diet, not the chicken', async () => {
    const { body } = await http().get(`/api/menus/${menuId}`).expect(200);
    await addPreference('diet', 'vegetarian');

    const res = await http()
      .post(`/api/menus/${menuId}/versions/${body.versions[0].id}/confirm`)
      .expect(400);
    expect(res.body.message).toContain('Chicken with rice is not vegetarian');
    expect(res.body.message).not.toContain('Oatmeal');
    expect(res.body.message).not.toContain('Rice bowl');
  });

  it('keeps the snapshot of a deleted recipe', async () => {
    await http().delete(`/api/recipes/${world.recipe.oats}`).expect(204);

    const { body } = await http().get(`/api/menus/${menuId}`).expect(200);
    expect(body.versions[0].days[0].meals[0]).toMatchObject({
      recipeId: null,
      recipe: { name: 'Oatmeal' },
      nutrition: { kcal: 444 },
    });
  });

  it('404s for unknown versions and menus', async () => {
    await http().post(`/api/menus/${menuId}/versions/${UNKNOWN_ID}/confirm`).expect(404);
    await http().get(`/api/menus/${UNKNOWN_ID}`).expect(404);
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
