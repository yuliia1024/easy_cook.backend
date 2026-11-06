import { DietTag, FoodState, MealType } from '../../../src/common/constants';
import {
  FoodItemsNotFoundBadRequestException,
  RecipeNotFoundException,
} from '../../../src/common/exceptions';
import { Page, PageQuery } from '../../../src/common/types';
import { FoodItem } from '../../../src/generated/prisma/client';
import { FoodItemFilter } from '../../../src/modules/data-access/food-item/food-item.repository';
import {
  RecipeFilter,
  RecipeWithIngredients,
} from '../../../src/modules/data-access/recipe/recipe.repository';
import { ChatToolsService } from '../../../src/modules/services/chat-tools/chat-tools.service';
import { FoodItemService } from '../../../src/modules/services/food-item/food-item.service';
import { NutritionService } from '../../../src/modules/services/nutrition/nutrition.service';
import { RecipeService } from '../../../src/modules/services/recipe/recipe.service';

/*
 * The recipes and foods the chat tools read in the evals: a small fixed catalog in memory, so a
 * case does not need a database and its numbers stay the same. The tools, `NutritionService` and
 * the rules run as in the app; only the two services that read the database are replaced.
 */

const CREATED_AT = new Date('2026-01-01T00:00:00Z');

/** Per 100 g of the food in its state: kcal, protein, fat, carbs. */
const food = (
  n: number,
  name: string,
  state: FoodState,
  [kcal, protein, fat, carbs]: [number, number, number, number],
): FoodItem =>
  ({
    id: `f0000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    name,
    nameEn: name,
    kcalPer100g: kcal,
    proteinG: protein,
    fatG: fat,
    carbsG: carbs,
    state,
    source: 'manual',
    sourceId: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }) as unknown as FoodItem;

export const CATALOG_FOODS = {
  chicken: food(1, 'Chicken breast, cooked', FoodState.Other, [165, 31, 3.6, 0]),
  rice: food(2, 'Rice, white, boiled', FoodState.Boiled, [130, 2.7, 0.3, 28]),
  lentils: food(3, 'Lentils, boiled', FoodState.Boiled, [116, 9, 0.4, 20]),
  chickpeas: food(4, 'Chickpeas, boiled', FoodState.Boiled, [164, 8.9, 2.6, 27]),
  coconutMilk: food(5, 'Coconut milk, canned', FoodState.Other, [197, 2, 21, 3]),
  oats: food(6, 'Oat flakes', FoodState.Dried, [370, 13, 7, 60]),
  peanutButter: food(7, 'Peanut butter', FoodState.Other, [590, 25, 50, 12]),
  salmon: food(8, 'Salmon, baked', FoodState.Other, [206, 22, 12, 0]),
  tomato: food(9, 'Tomato', FoodState.Raw, [18, 0.9, 0.2, 3.9]),
  bread: food(10, 'Whole wheat bread', FoodState.Other, [250, 13, 3.4, 41]),
  yogurt: food(11, 'Greek yogurt, plain', FoodState.Other, [97, 9, 5, 4]),
  spinach: food(12, 'Spinach', FoodState.Raw, [23, 2.9, 0.4, 3.6]),
  oliveOil: food(13, 'Olive oil', FoodState.Other, [884, 0, 100, 0]),
  tofu: food(14, 'Tofu, firm', FoodState.Raw, [144, 15.8, 8.7, 2.8]),
  banana: food(15, 'Banana', FoodState.Raw, [89, 1.1, 0.3, 23]),
};

type FoodKey = keyof typeof CATALOG_FOODS;

const recipe = (
  n: number,
  name: string,
  mealType: MealType,
  dietType: DietTag[],
  servings: number,
  ingredients: Array<[FoodKey, number]>,
  allergens: string[] = [],
): RecipeWithIngredients => {
  const id = `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return {
    id,
    name,
    description: null,
    instructions: `Prepare the ${name.toLowerCase()}.`,
    mealType,
    dietType,
    allergens,
    servings,
    prepTimeMinutes: 20,
    source: 'manual',
    sourceId: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ingredients: ingredients.map(([key, quantityG], position) => ({
      id: `${id.slice(0, -4)}${String(position).padStart(4, '0')}`,
      recipeId: id,
      foodItemId: CATALOG_FOODS[key].id,
      quantityG,
      isOptional: false,
      notes: null,
      position,
      foodItem: CATALOG_FOODS[key],
    })),
  } as unknown as RecipeWithIngredients;
};

const VEGAN = [DietTag.Vegan, DietTag.DairyFree];

export const CATALOG_RECIPES: RecipeWithIngredients[] = [
  recipe(1, 'Lentil soup', MealType.Lunch, [...VEGAN, DietTag.GlutenFree], 2, [
    ['lentils', 400],
    ['tomato', 200],
    ['spinach', 100],
  ]),
  recipe(2, 'Chickpea curry', MealType.Dinner, [...VEGAN, DietTag.GlutenFree], 2, [
    ['chickpeas', 300],
    ['coconutMilk', 200],
    ['tomato', 200],
    ['rice', 300],
  ]),
  recipe(3, 'Chicken with rice', MealType.Lunch, [DietTag.HighProtein, DietTag.DairyFree], 1, [
    ['chicken', 200],
    ['rice', 250],
  ]),
  recipe(4, 'Baked salmon with spinach', MealType.Dinner, [DietTag.Pescatarian], 1, [
    ['salmon', 180],
    ['spinach', 100],
    ['oliveOil', 5],
  ]),
  recipe(5, 'Chicken salad', MealType.Lunch, [DietTag.HighProtein, DietTag.LowCarb], 1, [
    ['chicken', 150],
    ['tomato', 150],
    ['spinach', 50],
    ['oliveOil', 10],
  ]),
  recipe(6, 'Oatmeal with banana', MealType.Breakfast, VEGAN, 1, [
    ['oats', 80],
    ['banana', 100],
  ]),
  recipe(7, 'Yogurt bowl', MealType.Breakfast, [DietTag.Vegetarian, DietTag.GlutenFree], 1, [
    ['yogurt', 200],
    ['banana', 100],
  ]),
  recipe(
    8,
    'Peanut butter toast',
    MealType.Snack,
    VEGAN,
    1,
    [
      ['bread', 60],
      ['peanutButter', 30],
    ],
    ['peanut', 'gluten'],
  ),
  recipe(9, 'Tofu stir-fry with rice', MealType.Dinner, VEGAN, 2, [
    ['tofu', 300],
    ['rice', 400],
    ['spinach', 100],
    ['oliveOil', 10],
  ]),
  recipe(10, 'Banana yogurt snack', MealType.Snack, [DietTag.Vegetarian], 1, [
    ['yogurt', 150],
    ['banana', 50],
  ]),
  recipe(11, 'Grilled chicken with spinach', MealType.Dinner, [DietTag.HighProtein], 1, [
    ['chicken', 220],
    ['spinach', 150],
    ['oliveOil', 10],
  ]),
];

const contains = (text: string | null, search: string | undefined): boolean =>
  !search || (text ?? '').toLowerCase().includes(search.toLowerCase());

const page = <T extends { name: string }>(items: T[], { page, limit }: PageQuery): Page<T> => {
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
  return { items: sorted.slice((page - 1) * limit, page * limit), total: sorted.length };
};

/** The reads of `RecipeService` the tools use, on `CATALOG_RECIPES`, as the repository filters. */
export const catalogRecipeService = {
  getPage: async (filter: RecipeFilter, query: PageQuery): Promise<Page<RecipeWithIngredients>> =>
    page(
      CATALOG_RECIPES.filter(
        (item) =>
          contains(item.name, filter.search) &&
          (!filter.mealType || item.mealType === filter.mealType) &&
          (filter.dietTypeGroups ?? []).every((group) =>
            group.some((tag) => item.dietType.includes(tag)),
          ),
      ),
      query,
    ),
  getById: async (id: string): Promise<RecipeWithIngredients> => {
    const found = CATALOG_RECIPES.find((item) => item.id === id);
    if (!found) {
      throw new RecipeNotFoundException();
    }
    return found;
  },
};

/** The reads of `FoodItemService` the tools use, on `CATALOG_FOODS`. */
export const catalogFoodItemService = {
  getPage: async (filter: FoodItemFilter, query: PageQuery): Promise<Page<FoodItem>> =>
    page(
      Object.values(CATALOG_FOODS).filter(
        (item) => contains(item.name, filter.search) || contains(item.nameEn, filter.search),
      ),
      query,
    ),
  getByIds: async (ids: string[]): Promise<Map<string, FoodItem>> => {
    const foods = Object.values(CATALOG_FOODS);
    const missing = ids.filter((id) => !foods.some((item) => item.id === id));
    if (missing.length > 0) {
      throw new FoodItemsNotFoundBadRequestException([...new Set(missing)]);
    }
    return new Map(foods.filter(({ id }) => ids.includes(id)).map((item) => [item.id, item]));
  },
};

/** The chat tools of the app on the catalog. */
export const catalogChatTools = (): ChatToolsService =>
  new ChatToolsService(
    catalogRecipeService as unknown as RecipeService,
    catalogFoodItemService as unknown as FoodItemService,
    new NutritionService(),
  );
