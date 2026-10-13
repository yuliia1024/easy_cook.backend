import request from 'supertest';
import { createTestApp, resetDatabase, TestApp } from './test-app';

describe('/api/recipes (e2e)', () => {
  let ctx: TestApp;
  const http = () => request(ctx.app.getHttpServer());
  const food: Record<string, string> = {};

  const createFood = async (key: string, data: object): Promise<void> => {
    const { body } = await http().post('/api/foods').send(data).expect(201);
    food[key] = body.id;
  };

  /** Control recipe: 300 g raw chicken + 150 g dry rice + 15 g olive oil (+ optional 10 g oil). */
  const recipeDto = () => ({
    name: 'Chicken with rice',
    instructions: 'Boil the rice, fry the chicken.',
    mealType: 'lunch',
    dietType: ['gluten_free', 'high_protein'],
    servings: 2,
    prepTimeMinutes: 30,
    ingredients: [
      { foodItemId: food.chicken, quantityG: 300 },
      { foodItemId: food.rice, quantityG: 150, notes: 'dry rice weight' },
      { foodItemId: food.oil, quantityG: 15 },
      { foodItemId: food.oil, quantityG: 10, isOptional: true, notes: 'for serving' },
    ],
  });

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    await createFood('chicken', {
      name: 'Chicken breast',
      state: 'raw',
      kcalPer100g: 120,
      proteinG: 22.5,
      fatG: 2.6,
      carbsG: 0,
    });
    await createFood('rice', {
      name: 'Rice, dry',
      state: 'dried',
      kcalPer100g: 365,
      proteinG: 7.1,
      fatG: 0.66,
      carbsG: 80,
    });
    await createFood('oil', {
      name: 'Olive oil',
      state: 'other',
      kcalPer100g: 884,
      proteinG: 0,
      fatG: 100,
      carbsG: 0,
    });
    await createFood('sauce', { name: 'Sauce', state: 'other', kcalPer100g: 80 });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const create = async (patch: object = {}) =>
    (
      await http()
        .post('/api/recipes')
        .send({ ...recipeDto(), ...patch })
        .expect(201)
    ).body;

  describe('POST', () => {
    it('creates a recipe with ordered ingredients and nutrition per serving', async () => {
      const recipe = await create();

      expect(recipe).toMatchObject({
        name: 'Chicken with rice',
        source: 'manual',
        servings: 2,
        nutritionPerServing: { kcal: 520.1, proteinG: 39.1, fatG: 11.9, carbsG: 60 },
        nutritionComplete: true,
      });
      expect(recipe.ingredients.map((i: { position: number }) => i.position)).toEqual([0, 1, 2, 3]);
      expect(recipe.ingredients[1]).toMatchObject({
        quantityG: 150,
        notes: 'dry rice weight',
        foodItem: { name: 'Rice, dry', state: 'dried' },
      });
    });

    it('refuses an unknown food', async () => {
      const missing = '2b1e7f3a-5d47-4a8e-9f6c-1d2e3f4a5b6c';
      const { body } = await http()
        .post('/api/recipes')
        .send({ ...recipeDto(), ingredients: [{ foodItemId: missing, quantityG: 10 }] })
        .expect(400);

      expect(body.message).toBe(`Food items not found: ${missing}`);
    });

    it.each([
      ['no ingredients', { ingredients: [] }],
      [
        'a zero quantity',
        { ingredients: [{ foodItemId: '2b1e7f3a-5d47-4a8e-9f6c-1d2e3f4a5b6c', quantityG: 0 }] },
      ],
      ['an unknown diet tag', { dietType: ['paleo'] }],
      ['an unknown meal type', { mealType: 'brunch' }],
    ])('rejects %s', async (_case, patch) => {
      await http()
        .post('/api/recipes')
        .send({ ...recipeDto(), ...patch })
        .expect(400);
    });
  });

  describe('GET', () => {
    beforeEach(async () => {
      await create();
      await create({
        name: 'Vegetable soup',
        mealType: 'dinner',
        dietType: ['vegan', 'gluten_free'],
      });
      await create({ name: 'Salad', mealType: 'dinner', dietType: ['vegan'] });
    });

    it('filters by name, meal type and every given diet tag', async () => {
      const byName = await http().get('/api/recipes').query({ search: 'SOUP' }).expect(200);
      const byMeal = await http().get('/api/recipes').query({ mealType: 'dinner' }).expect(200);
      const byTags = await http()
        .get('/api/recipes')
        .query('dietType=vegan&dietType=gluten_free')
        .expect(200);
      const byCsv = await http()
        .get('/api/recipes')
        .query({ dietType: 'vegan,gluten_free' })
        .expect(200);

      expect(byName.body.items.map((r: { name: string }) => r.name)).toEqual(['Vegetable soup']);
      expect(byMeal.body.total).toBe(2);
      expect(byTags.body.items.map((r: { name: string }) => r.name)).toEqual(['Vegetable soup']);
      expect(byCsv.body.total).toBe(1);
    });

    it('pages', async () => {
      const { body } = await http().get('/api/recipes').query({ limit: 1 }).expect(200);

      expect(body).toMatchObject({ total: 3, page: 1, limit: 1 });
      expect(body.items).toHaveLength(1);
    });
  });

  describe('GET /:id/nutrition', () => {
    it('matches the control example', async () => {
      const recipe = await create();

      const { body } = await http().get(`/api/recipes/${recipe.id}/nutrition`).expect(200);

      expect(body).toMatchObject({
        servings: 2,
        includeOptional: false,
        basis: 'ingredients_sum',
        total: { kcal: 1040.1, proteinG: 78.2, fatG: 23.8, carbsG: 120 },
        perServing: { kcal: 520.1, proteinG: 39.1, fatG: 11.9, carbsG: 60 },
        complete: true,
      });
      expect(body.ingredients[3]).toMatchObject({ counted: false, macros: { kcal: 88.4 } });
    });

    it('counts optional ingredients on request', async () => {
      const recipe = await create();

      const { body } = await http()
        .get(`/api/recipes/${recipe.id}/nutrition`)
        .query({ includeOptional: true })
        .expect(200);

      expect(body.total.kcal).toBe(1128.5);
    });

    it('flags unknown values', async () => {
      const recipe = await create({ ingredients: [{ foodItemId: food.sauce, quantityG: 50 }] });

      const { body } = await http().get(`/api/recipes/${recipe.id}/nutrition`).expect(200);

      expect(body.complete).toBe(false);
      expect(body.total.kcal).toBe(40);
      expect(body.ingredients[0].missing).toEqual(['proteinG', 'fatG', 'carbsG']);
    });
  });

  describe('PATCH / DELETE', () => {
    it('changes fields and replaces the ingredient list', async () => {
      const recipe = await create();

      const { body } = await http()
        .patch(`/api/recipes/${recipe.id}`)
        .send({ servings: 1, ingredients: [{ foodItemId: food.chicken, quantityG: 100 }] })
        .expect(200);

      expect(body.servings).toBe(1);
      expect(body.ingredients).toHaveLength(1);
      expect(body.nutritionPerServing.kcal).toBe(120);
    });

    it('deletes with its ingredients', async () => {
      const recipe = await create();

      await http().delete(`/api/recipes/${recipe.id}`).expect(204);
      await http().get(`/api/recipes/${recipe.id}`).expect(404);
      expect(await ctx.prisma.recipeIngredient.count()).toBe(0);
    });
  });

  describe('ingredients', () => {
    it('adds, updates and removes one', async () => {
      const recipe = await create({ ingredients: [{ foodItemId: food.chicken, quantityG: 100 }] });

      const added = await http()
        .post(`/api/recipes/${recipe.id}/ingredients`)
        .send({ foodItemId: food.rice, quantityG: 50 })
        .expect(201);
      const ingredientId = added.body.ingredients[1].id;
      expect(added.body.ingredients[1].position).toBe(1);

      const updated = await http()
        .patch(`/api/recipes/${recipe.id}/ingredients/${ingredientId}`)
        .send({ quantityG: 75, isOptional: true })
        .expect(200);
      expect(updated.body.ingredients[1]).toMatchObject({ quantityG: 75, isOptional: true });

      const removed = await http()
        .delete(`/api/recipes/${recipe.id}/ingredients/${ingredientId}`)
        .expect(200);
      expect(removed.body.ingredients).toHaveLength(1);
    });

    it('refuses an unknown food and an ingredient of another recipe', async () => {
      const first = await create();
      const second = await create({ name: 'Another' });

      await http()
        .post(`/api/recipes/${first.id}/ingredients`)
        .send({ foodItemId: '2b1e7f3a-5d47-4a8e-9f6c-1d2e3f4a5b6c', quantityG: 5 })
        .expect(400);
      await http()
        .delete(`/api/recipes/${first.id}/ingredients/${second.ingredients[0].id}`)
        .expect(404);
    });
  });

  it('keeps a food that a recipe uses', async () => {
    await create();

    await expect(ctx.prisma.foodItem.delete({ where: { id: food.chicken } })).rejects.toThrow();
  });
});
