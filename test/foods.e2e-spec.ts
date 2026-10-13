import request from 'supertest';
import { createTestApp, resetDatabase, TestApp } from './test-app';

describe('/api/foods (e2e)', () => {
  let ctx: TestApp;
  const http = () => request(ctx.app.getHttpServer());

  const riceDry = {
    name: 'Рис білий, сухий',
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

  describe('POST', () => {
    it('creates a food with the manual source', async () => {
      const { body } = await http().post('/api/foods').send(riceDry).expect(201);

      expect(body).toMatchObject({ ...riceDry, source: 'manual', sourceId: null });
      expect(body.id).toEqual(expect.any(String));
    });

    it('stores unknown nutrients as null', async () => {
      const { body } = await http()
        .post('/api/foods')
        .send({ name: 'Соус', state: 'other', kcalPer100g: 80 })
        .expect(201);

      expect(body).toMatchObject({ kcalPer100g: 80, proteinG: null, fatG: null, carbsG: null });
    });

    it.each([
      ['negative values', { kcalPer100g: -1 }],
      ['an unknown state', { state: 'grilled' }],
      ['unknown fields', { color: 'white' }],
    ])('rejects %s with 400', async (_case, patch) => {
      await http()
        .post('/api/foods')
        .send({ ...riceDry, ...patch })
        .expect(400);
    });

    it('rejects macros heavier than 100 g', async () => {
      const { body } = await http()
        .post('/api/foods')
        .send({ ...riceDry, proteinG: 50, fatG: 30, carbsG: 30 })
        .expect(400);

      expect(body.message).toContain('cannot exceed 100 g');
    });

    it('keeps source + source id unique', async () => {
      const usda = { ...riceDry, source: 'usda_fdc', sourceId: '168877' };
      await http().post('/api/foods').send(usda).expect(201);

      await http().post('/api/foods').send(usda).expect(409);
    });
  });

  describe('GET', () => {
    beforeEach(async () => {
      await http().post('/api/foods').send(riceDry).expect(201);
      await http()
        .post('/api/foods')
        .send({
          ...riceDry,
          name: 'Рис білий, варений',
          nameEn: 'Rice, white, cooked',
          state: 'boiled',
          kcalPer100g: 130,
          proteinG: 2.7,
          fatG: 0.3,
          carbsG: 28.2,
        })
        .expect(201);
      await http()
        .post('/api/foods')
        .send({ name: 'Гречка, суха', nameEn: 'Buckwheat', state: 'dried', kcalPer100g: 343 })
        .expect(201);
    });

    it('pages sorted by name', async () => {
      const { body } = await http().get('/api/foods').query({ limit: 2, page: 2 }).expect(200);

      expect(body).toMatchObject({ total: 3, page: 2, limit: 2 });
      expect(body.items.map((f: { name: string }) => f.name)).toEqual(['Рис білий, сухий']);
    });

    it('searches both names, case-insensitively', async () => {
      const uk = await http().get('/api/foods').query({ search: 'РИС' }).expect(200);
      const en = await http().get('/api/foods').query({ search: 'buckwheat' }).expect(200);

      expect(uk.body.total).toBe(2);
      expect(en.body.items[0].name).toBe('Гречка, суха');
    });

    it('filters by state', async () => {
      const { body } = await http().get('/api/foods').query({ state: 'boiled' }).expect(200);

      expect(body.items.map((f: { name: string }) => f.name)).toEqual(['Рис білий, варений']);
    });

    it('rejects a page size over the limit', async () => {
      await http().get('/api/foods').query({ limit: 500 }).expect(400);
    });

    it('gets one by id, 404 for an unknown one, 400 for a malformed one', async () => {
      const { body } = await http().get('/api/foods').query({ search: 'гречка' });
      const id = body.items[0].id;

      await http().get(`/api/foods/${id}`).expect(200);
      await http().get('/api/foods/2b1e7f3a-5d47-4a8e-9f6c-1d2e3f4a5b6c').expect(404);
      await http().get('/api/foods/not-a-uuid').expect(400);
    });
  });

  describe('PATCH', () => {
    it('updates and clears values', async () => {
      const { body: food } = await http().post('/api/foods').send(riceDry).expect(201);

      const { body } = await http()
        .patch(`/api/foods/${food.id}`)
        .send({ name: 'Рис басматі', fatG: null })
        .expect(200);

      expect(body).toMatchObject({ name: 'Рис басматі', fatG: null, kcalPer100g: 365 });
    });

    it('checks the macros against the stored values', async () => {
      const { body: food } = await http().post('/api/foods').send(riceDry).expect(201);

      await http().patch(`/api/foods/${food.id}`).send({ proteinG: 25 }).expect(400);
    });
  });
});
