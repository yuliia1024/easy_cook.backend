import request, { Test } from 'supertest';
import { TestApp } from './test-app';

export interface MenuWorld {
  /** Recipe ids by key. */
  recipe: Record<'oats' | 'chicken' | 'bowl' | 'satay', string>;
}

/**
 * Profile (female, 30, 170 cm, 65 kg, moderate, maintain), a calculated goal of 2172 kcal and four
 * one-serving recipes: oats (breakfast), chicken with rice (lunch), a vegan rice bowl and a vegan
 * peanut satay (dinner).
 */
export async function createMenuWorld(
  ctx: TestApp,
  { goal = true }: { goal?: boolean } = {},
): Promise<MenuWorld> {
  const http = () => request(ctx.app.getHttpServer());
  const post = (path: string, body: object): Test => http().post(path).send(body).expect(201);

  await http()
    .put('/api/profile')
    .send({
      age: 30,
      heightCm: 170,
      weightKg: 65,
      sex: 'female',
      activityLevel: 'moderate',
      goal: 'maintain',
    })
    .expect(200);
  if (goal) {
    await post('/api/nutrition/goals/calculate', {});
  }

  const food = async (name: string, kcal: number, p: number, f: number, c: number) =>
    (
      await post('/api/foods', {
        name,
        state: 'other',
        kcalPer100g: kcal,
        proteinG: p,
        fatG: f,
        carbsG: c,
      })
    ).body.id as string;
  const oats = await food('Oat flakes, dry', 370, 13, 7, 60);
  const rice = await food('Rice, boiled', 130, 2.7, 0.3, 28);
  const chicken = await food('Chicken breast, cooked', 165, 31, 3.6, 0);
  const peanut = await food('Peanut butter', 590, 25, 50, 12);

  const recipe = async (
    name: string,
    mealType: string,
    dietType: string[],
    ingredients: Array<[string, number]>,
  ) =>
    (
      await post('/api/recipes', {
        name,
        instructions: 'Cook.',
        mealType,
        dietType,
        servings: 1,
        ingredients: ingredients.map(([foodItemId, quantityG]) => ({ foodItemId, quantityG })),
      })
    ).body.id as string;

  return {
    recipe: {
      oats: await recipe('Oatmeal', 'breakfast', ['vegan'], [[oats, 120]]),
      chicken: await recipe(
        'Chicken with rice',
        'lunch',
        [],
        [
          [chicken, 200],
          [rice, 250],
        ],
      ),
      bowl: await recipe('Rice bowl', 'dinner', ['vegan'], [[rice, 400]]),
      satay: await recipe(
        'Peanut satay',
        'dinner',
        ['vegan'],
        [
          [rice, 300],
          [peanut, 40],
        ],
      ),
    },
  };
}
