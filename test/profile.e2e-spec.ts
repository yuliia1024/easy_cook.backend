import request from 'supertest';
import { createTestApp, resetDatabase, TestApp } from './test-app';

const DAY_MS = 24 * 60 * 60 * 1000;

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

    it('rejects null in a patch instead of failing in the database', async () => {
      await http().put('/api/profile').send(profile).expect(200);

      await http().patch('/api/profile').send({ age: null }).expect(400);
    });

    it('checks the BMI and the weight loss goal', async () => {
      const implausible = await http()
        .put('/api/profile')
        .send({ ...profile, heightCm: 250, weightKg: 30 })
        .expect(400);
      expect(implausible.body.message).toContain('implausible BMI');

      // 170 cm, 50 kg -> BMI 17.3
      await http()
        .put('/api/profile')
        .send({ ...profile, weightKg: 50 })
        .expect(200);
      const underweight = await http()
        .patch('/api/profile')
        .send({ goal: 'lose_weight' })
        .expect(400);
      expect(underweight.body.message).toContain('BMI below 18.5');
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
        ruleVersion: 'mifflin-st-jeor-v2',
      });
    });

    it('keeps the history and serves the latest goal in effect', async () => {
      await http().get('/api/nutrition/goals/current').expect(404);

      await http().post('/api/nutrition/goals/calculate').expect(201);
      await http()
        .post('/api/nutrition/goals')
        .send({ caloriesKcal: 1800, proteinG: 110, fatG: 55, carbsG: 230 })
        .expect(201);
      await http()
        .post('/api/nutrition/goals')
        .send({
          caloriesKcal: 2500,
          proteinG: 120,
          fatG: 80,
          carbsG: 300,
          effectiveFrom: new Date(Date.now() + 30 * DAY_MS).toISOString(),
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

      const ascending = await http()
        .get('/api/nutrition/goals')
        .query({ sortOrder: 'asc' })
        .expect(200);
      expect(ascending.body.map((g: { caloriesKcal: number }) => g.caloriesKcal)).toEqual([
        2172, 1800, 2500,
      ]);
      await http().get('/api/nutrition/goals').query({ sortOrder: 'up' }).expect(400);
    });

    it('recalculates the macros for calories set by hand', async () => {
      const { body } = await http()
        .get('/api/nutrition/goals/preview')
        .query({ caloriesKcal: 1500 })
        .expect(200);

      expect(body).toEqual({ caloriesKcal: 1500, proteinG: 104, fatG: 42, carbsG: 177 });
      await http().get('/api/nutrition/goals/preview').query({ caloriesKcal: 1199 }).expect(400);
    });

    it('enforces the minimum calories for the profile sex', async () => {
      const goal = { caloriesKcal: 1200, proteinG: 75, fatG: 40, carbsG: 150 };

      await http().post('/api/nutrition/goals').send(goal).expect(201);
      await http()
        .post('/api/nutrition/goals')
        .send({ ...goal, caloriesKcal: 1199 })
        .expect(400);

      await http()
        .put('/api/profile')
        .send({ ...profile, sex: 'male' })
        .expect(200);
      const { body } = await http().post('/api/nutrition/goals').send(goal).expect(400);
      expect(body.message).toContain('1500 kcal');
      await http().get('/api/nutrition/goals/preview').query({ caloriesKcal: 1200 }).expect(400);
    });

    it('rejects macros that do not add up or leave the healthy ranges', async () => {
      const mismatch = await http()
        .post('/api/nutrition/goals')
        .send({ caloriesKcal: 2000, proteinG: 50, fatG: 30, carbsG: 150 })
        .expect(400);
      expect(mismatch.body.message).toContain('more than 10 % away from the 2000 kcal goal');

      const protein = await http()
        .post('/api/nutrition/goals')
        .send({ caloriesKcal: 1800, proteinG: 200, fatG: 50, carbsG: 137 })
        .expect(400);
      expect(protein.body.message).toBe('Protein must be 10-35 % of the calories (now 44 %)');
    });

    it('accepts a start date from today up to a year ahead', async () => {
      const goal = { caloriesKcal: 1800, proteinG: 110, fatG: 55, carbsG: 230 };
      const at = (days: number): string => new Date(Date.now() + days * DAY_MS).toISOString();

      await http()
        .post('/api/nutrition/goals')
        .send({ ...goal, effectiveFrom: at(-0.5) })
        .expect(201);
      await http()
        .post('/api/nutrition/goals')
        .send({ ...goal, effectiveFrom: at(-2) })
        .expect(400);
      await http()
        .post('/api/nutrition/goals')
        .send({ ...goal, effectiveFrom: at(400) })
        .expect(400);
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

    it('rejects diets that cannot be followed together', async () => {
      await http()
        .post('/api/preferences')
        .send({ preferenceType: 'diet', value: 'vegan' })
        .expect(201);

      const { body } = await http()
        .post('/api/preferences')
        .send({ preferenceType: 'diet', value: 'pescatarian' })
        .expect(400);
      expect(body.message).toBe('Diet "pescatarian" conflicts with "vegan"');
    });
  });

  it('/api/menus is empty for a new profile', async () => {
    await http().put('/api/profile').send(profile).expect(200);

    await http().get('/api/menus').expect(200, []);
    await http().get('/api/menus/2b1e7f3a-5d47-4a8e-9f6c-1d2e3f4a5b6c').expect(404);
  });
});
