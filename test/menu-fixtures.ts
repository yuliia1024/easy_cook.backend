import request, { Test } from 'supertest';
import { MealType, MenuGeneratedBy, MenuIssueSeverity } from '../src/common/constants';
import { RecipeSnapshot } from '../src/common/types';
import { toNumber } from '../src/common/utils';
import { Prisma } from '../src/generated/prisma/client';
import {
  RECIPE_INCLUDE,
  RecipeWithIngredients,
} from '../src/modules/data-access/recipe/recipe.repository';
import { MenuComposer } from '../src/modules/services/menu/menu-composer';
import { composeMenu, ResolvedDay } from '../src/modules/services/menu/menu-composition';
import { validateMenu } from '../src/modules/services/menu/menu-rules';
import {
  NutritionService,
  RecipeNutrition,
} from '../src/modules/services/nutrition/nutrition.service';
import { TestApp } from './test-app';

export interface MenuDayBody {
  dayIndex: number;
  date?: string | null;
  meals: Array<{ mealType: MealType | string; recipeId: string; servings: number }>;
}

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
  const { profileId } = await ctx.app.get(MenuComposer).context();
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
  const context = await ctx.app.get(MenuComposer).context();
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
        recipe: snapshot(recipe, nutrition.calculateRecipe(recipe)),
      };
    }),
  }));
  const composed = composeMenu(resolved);
  const issues = validateMenu(resolved, composed.days, context.rules, context.goal);
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
      nutritionGoalsSnapshot: context.goal
        ? (context.goal as unknown as Prisma.InputJsonObject)
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

/** What a version keeps of a recipe; `nutrition` is the recipe without optional ingredients. */
function snapshot(recipe: RecipeWithIngredients, nutrition: RecipeNutrition): RecipeSnapshot {
  return {
    id: recipe.id,
    name: recipe.name,
    mealType: recipe.mealType,
    dietType: recipe.dietType,
    servings: recipe.servings,
    prepTimeMinutes: recipe.prepTimeMinutes,
    perServing: nutrition.perServing,
    complete: nutrition.complete,
    ingredients: recipe.ingredients.map((ingredient) => ({
      foodItemId: ingredient.foodItemId,
      foodName: ingredient.foodItem.name,
      foodNameEn: ingredient.foodItem.nameEn,
      state: ingredient.foodItem.state,
      quantityG: toNumber(ingredient.quantityG),
      isOptional: ingredient.isOptional,
    })),
  };
}
