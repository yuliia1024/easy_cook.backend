import { createFood } from './catalog-fixtures';
import { createTestApp, resetDatabase, TestApp } from './test-app';

describe('/api/foods (e2e)', () => {
  let ctx: TestApp;
  const http = () => ctx.http();

  const riceDry = {
    name: 'White rice, dry',
    nameEn: 'Rice, white, raw',
    kcalPer100g: 365,
    proteinG: 7.1,
    fatG: 0.66,
    carbsG: 80,
    state: 'dried',
  };

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('is read only: no route writes the catalog', async () => {
    const id = await createFood(ctx.prisma, riceDry);

    await http().post('/api/foods').send(riceDry).expect(404);
    await http().patch(`/api/foods/${id}`).send({ name: 'Rice' }).expect(404);
    expect(await ctx.prisma.foodItem.count()).toBe(1);
  });

  describe('GET', () => {
    beforeEach(async () => {
      await createFood(ctx.prisma, riceDry);
      await createFood(ctx.prisma, {
        ...riceDry,
        name: 'White rice, boiled',
        nameEn: 'Rice, white, cooked',
        state: 'boiled',
        kcalPer100g: 130,
        proteinG: 2.7,
        fatG: 0.3,
        carbsG: 28.2,
      });
      await createFood(ctx.prisma, {
        name: 'Buckwheat, dry',
        nameEn: 'Buckwheat groats, roasted',
        state: 'dried',
        kcalPer100g: 343,
      });
    });

    it('pages sorted by name', async () => {
      const { body } = await http().get('/api/foods').query({ limit: 2, page: 2 }).expect(200);

      expect(body).toMatchObject({ total: 3, page: 2, limit: 2 });
      expect(body.items.map((f: { name: string }) => f.name)).toEqual(['White rice, dry']);
    });

    it('searches both names, case-insensitively', async () => {
      const byName = await http().get('/api/foods').query({ search: 'RICE' }).expect(200);
      const byNameEn = await http().get('/api/foods').query({ search: 'GROATS' }).expect(200);

      expect(byName.body.total).toBe(2);
      expect(byNameEn.body.items[0].name).toBe('Buckwheat, dry');
    });

    it('filters by state', async () => {
      const { body } = await http().get('/api/foods').query({ state: 'boiled' }).expect(200);

      expect(body.items.map((f: { name: string }) => f.name)).toEqual(['White rice, boiled']);
    });

    it('sorts by name in the requested order', async () => {
      const { body } = await http().get('/api/foods').query({ sortOrder: 'desc' }).expect(200);

      expect(body.items.map((f: { name: string }) => f.name)).toEqual([
        'White rice, dry',
        'White rice, boiled',
        'Buckwheat, dry',
      ]);
    });

    it('rejects an unknown sort order', async () => {
      await http().get('/api/foods').query({ sortOrder: 'up' }).expect(400);
    });

    it('rejects a page size over the limit', async () => {
      await http().get('/api/foods').query({ limit: 500 }).expect(400);
    });

    it('gets one by id, 404 for an unknown one, 400 for a malformed one', async () => {
      const { body } = await http().get('/api/foods').query({ search: 'buckwheat' });
      const id = body.items[0].id;

      await http().get(`/api/foods/${id}`).expect(200);
      await http().get('/api/foods/2b1e7f3a-5d47-4a8e-9f6c-1d2e3f4a5b6c').expect(404);
      await http().get('/api/foods/not-a-uuid').expect(400);
    });
  });
});
