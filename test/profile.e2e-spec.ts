import request from 'supertest';
import { createTestApp, resetDatabase, TestApp } from './test-app';

describe('profile, nutrition goals and preferences (e2e)', () => {
  let ctx: TestApp;
  const http = () => request(ctx.app.getHttpServer());
  const profile = {
    age: 30,
    heightCm: 170,
    weightKg: 65,
    sex: 'female',
    activityLevel: 'moderate',
    goal: 'maintain',
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

  describe('/api/profile', () => {
    it('is 404 until saved, then upserts one profile', async () => {
      await http().get('/api/profile').expect(404);

      const created = await http().put('/api/profile').send(profile).expect(200);
      const replaced = await http()
        .put('/api/profile')
        .send({ ...profile, age: 31 })
        .expect(200);
      const patched = await http().patch('/api/profile').send({ weightKg: 63.5 }).expect(200);

      expect(replaced.body.id).toBe(created.body.id);
      expect(patched.body).toMatchObject({ age: 31, weightKg: 63.5, heightCm: 170 });
      expect(await ctx.prisma.userProfile.count()).toBe(1);
    });

    it('validates the fields', async () => {
      await http()
        .put('/api/profile')
        .send({ ...profile, sex: 'other' })
        .expect(400);
      await http().put('/api/profile').send({ age: 30 }).expect(400);
    });

    it('lists the options', async () => {
      const { body } = await http().get('/api/profile/options').expect(200);

      expect(body.goals).toEqual(['lose_weight', 'maintain', 'gain_muscle']);
      expect(body.dietTags).toContain('vegan');
    });
  });

  describe('/api/nutrition/goals', () => {
    beforeEach(async () => {
      await http().put('/api/profile').send(profile).expect(200);
    });

    it('calculates rule based targets from the profile', async () => {
      const preview = await http().get('/api/nutrition/goals/preview').expect(200);
      const { body } = await http().post('/api/nutrition/goals/calculate').expect(201);

      expect(preview.body).toEqual({ caloriesKcal: 2172, proteinG: 104, fatG: 60, carbsG: 303 });
      expect(body).toMatchObject({
        ...preview.body,
        calculationMode: 'rule_based',
        ruleVersion: 'mifflin-st-jeor-v1',
      });
    });

    it('keeps the history and serves the latest goal in effect', async () => {
      await http().get('/api/nutrition/goals/current').expect(404);

      await http().post('/api/nutrition/goals/calculate').expect(201);
      await http()
        .post('/api/nutrition/goals')
        .send({ caloriesKcal: 1800, proteinG: 120, fatG: 60, carbsG: 195 })
        .expect(201);
      await http()
        .post('/api/nutrition/goals')
        .send({
          caloriesKcal: 2500,
          proteinG: 120,
          fatG: 80,
          carbsG: 300,
          effectiveFrom: '2099-01-01T00:00:00Z',
        })
        .expect(201);

      const current = await http().get('/api/nutrition/goals/current').expect(200);
      const history = await http().get('/api/nutrition/goals').expect(200);

      expect(current.body).toMatchObject({
        caloriesKcal: 1800,
        calculationMode: 'manual',
        ruleVersion: null,
      });
      expect(history.body.map((g: { caloriesKcal: number }) => g.caloriesKcal)).toEqual([
        2500, 1800, 2172,
      ]);
    });

    it('needs a profile', async () => {
      await resetDatabase(ctx.prisma);

      await http().post('/api/nutrition/goals/calculate').expect(404);
    });
  });

  describe('/api/preferences', () => {
    beforeEach(async () => {
      await http().put('/api/profile').send(profile).expect(200);
    });

    it('adds, lists and removes', async () => {
      const { body: allergy } = await http()
        .post('/api/preferences')
        .send({ preferenceType: 'allergy', value: ' Peanut ' })
        .expect(201);
      await http()
        .post('/api/preferences')
        .send({ preferenceType: 'diet', value: 'vegetarian' })
        .expect(201);

      const list = await http().get('/api/preferences').expect(200);
      expect(list.body).toEqual([
        { id: allergy.id, preferenceType: 'allergy', value: 'peanut' },
        expect.objectContaining({ preferenceType: 'diet', value: 'vegetarian' }),
      ]);

      await http().delete(`/api/preferences/${allergy.id}`).expect(204);
      await http().delete(`/api/preferences/${allergy.id}`).expect(404);
    });

    it('rejects duplicates and unknown diets', async () => {
      await http()
        .post('/api/preferences')
        .send({ preferenceType: 'allergy', value: 'peanut' })
        .expect(201);

      await http()
        .post('/api/preferences')
        .send({ preferenceType: 'allergy', value: 'PEANUT' })
        .expect(409);
      await http()
        .post('/api/preferences')
        .send({ preferenceType: 'diet', value: 'carnivore' })
        .expect(400);
    });
  });

  it('/api/menus is empty until the AI flow creates menus', async () => {
    await http().put('/api/profile').send(profile).expect(200);

    await http().get('/api/menus').expect(200, []);
    await http().get('/api/menus/2b1e7f3a-5d47-4a8e-9f6c-1d2e3f4a5b6c').expect(404);
  });
});
