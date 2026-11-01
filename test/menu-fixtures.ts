import request, { Test } from 'supertest';
import {
  MealType,
  MENU_PLAN_MEAL_TYPES,
  MenuGeneratedBy,
  MenuIssueSeverity,
} from '../src/common/constants';
import { ResolvedDay } from '../src/common/types';
import { Prisma } from '../src/generated/prisma/client';
import { RECIPE_INCLUDE } from '../src/modules/data-access/recipe/recipe.repository';
import { composeMenu, snapshotRecipe } from '../src/modules/services/menu/menu-composition';
import { validateMenu } from '../src/modules/services/menu/menu-rules';
import { NutritionService } from '../src/modules/services/nutrition/nutrition.service';
import { ProfileContextService } from '../src/modules/services/profile-context/profile-context.service';
import { TestApp } from './test-app';

export interface MenuDayBody {
  dayIndex: number;
  date?: string | null;
  meals: Array<{ mealType: MealType | string; recipeId: string; servings: number }>;
}

export interface MenuWorld {
  /** Recipe ids by key. */
  recipe: Record<'oats' | 'chicken' | 'bowl' | 'satay' | 'snack', string>;
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
      snack: await recipe('Oat snack', 'snack', ['vegan'], [[oats, 30]]),
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

/** A vegan lunch, `Lentil stew` (400 g boiled lentils), for menus that leave out the chicken. */
export async function addLentilStew(ctx: TestApp): Promise<string> {
  const post = (path: string, body: object): Test =>
    request(ctx.app.getHttpServer()).post(path).send(body).expect(201);
  const lentils = (
    await post('/api/foods', {
      name: 'Lentils, boiled',
      state: 'boiled',
      kcalPer100g: 116,
      proteinG: 9,
      fatG: 0.4,
      carbsG: 20,
    })
  ).body.id as string;
  return (
    await post('/api/recipes', {
      name: 'Lentil stew',
      instructions: 'Cook.',
      mealType: 'lunch',
      dietType: ['vegan'],
      servings: 1,
      ingredients: [{ foodItemId: lentils, quantityG: 400 }],
    })
  ).body.id as string;
}

/**
 * A menu with a manual version 1, saved directly through Prisma: the API does not create menus.
 * Fails on broken rules, so a seeded version can always be confirmed until the rules change.
 */
export async function seedMenu(
  ctx: TestApp,
  title: string,
  days: MenuDayBody[],
  notes: string | null = null,
): Promise<string> {
  const { profileId } = await ctx.app.get(ProfileContextService).get();
  const menu = await ctx.prisma.menu.create({ data: { profileId, title } });
  await seedVersion(ctx, menu.id, days, notes);
  return menu.id;
}

/**
 * Appends the next version to a seeded menu, the way versions used to be built: recipe
 * snapshots, nutrition per meal and day, and the issues against the current goal and rules.
 */
export async function seedVersion(
  ctx: TestApp,
  menuId: string,
  days: MenuDayBody[],
  notes: string | null = null,
): Promise<string> {
  const context = await ctx.app.get(ProfileContextService).get();
  const nutrition = ctx.app.get(NutritionService);
  const recipes = new Map(
    (
      await ctx.prisma.recipe.findMany({
        where: { id: { in: days.flatMap((day) => day.meals.map((meal) => meal.recipeId)) } },
        include: RECIPE_INCLUDE,
      })
    ).map((recipe) => [recipe.id, recipe]),
  );

  const resolved: ResolvedDay[] = days.map((day) => ({
    dayIndex: day.dayIndex,
    date: day.date ? new Date(`${day.date}T00:00:00.000Z`) : null,
    meals: day.meals.map((meal) => {
      const recipe = recipes.get(meal.recipeId);
      if (!recipe) {
        throw new Error(`Cannot seed the menu: recipe ${meal.recipeId} does not exist`);
      }
      return {
        mealType: meal.mealType as MealType,
        servings: meal.servings,
        recipeId: recipe.id,
        recipe: snapshotRecipe(recipe, nutrition.calculateRecipe(recipe)),
      };
    }),
  }));
  const composed = composeMenu(resolved);
  const issues = validateMenu(resolved, composed.days, context.rules, context.nutritionGoal);
  if (issues.some((issue) => issue.severity === MenuIssueSeverity.Error)) {
    throw new Error(`Cannot seed the menu: ${JSON.stringify(issues)}`);
  }

  const versionNumber = (await ctx.prisma.menuVersion.count({ where: { menuId } })) + 1;
  const version = await ctx.prisma.menuVersion.create({
    data: {
      menuId,
      versionNumber,
      generatedBy: MenuGeneratedBy.Manual,
      notes,
      nutritionGoalsSnapshot: context.nutritionGoal
        ? (context.nutritionGoal as unknown as Prisma.InputJsonObject)
        : Prisma.JsonNull,
      compositionSnapshot: { ...composed, issues } as unknown as Prisma.InputJsonObject,
      days: {
        create: resolved.map((day) => ({
          dayIndex: day.dayIndex,
          date: day.date,
          meals: {
            create: day.meals.map((meal, position) => ({
              position,
              mealType: meal.mealType,
              servings: meal.servings,
              recipeId: meal.recipeId,
              recipeSnapshot: meal.recipe as unknown as Prisma.InputJsonObject,
            })),
          },
        })),
      },
    },
  });
  return version.id;
}

/**
 * `count` more vegan recipes of every meal of a planned day (`Rice breakfast 1`, ...), each a
 * serving of boiled rice from `createMenuWorld`, so a menu of several days has enough of them.
 */
export async function addRiceRecipes(ctx: TestApp, count: number): Promise<void> {
  const rice = await ctx.prisma.foodItem.findFirstOrThrow({ where: { name: 'Rice, boiled' } });
  for (const mealType of MENU_PLAN_MEAL_TYPES) {
    for (let i = 1; i <= count; i++) {
      await request(ctx.app.getHttpServer())
        .post('/api/recipes')
        .send({
          name: `Rice ${mealType} ${i}`,
          instructions: 'Cook.',
          mealType,
          dietType: ['vegan'],
          servings: 1,
          ingredients: [{ foodItemId: rice.id, quantityG: 200 }],
        })
        .expect(201);
    }
  }
}
