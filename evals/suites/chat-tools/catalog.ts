import {
  DietTag,
  FoodState,
  MealType,
  MessageRole,
  PreferenceChangeAction,
  PreferenceChangeStatus,
  PreferenceType,
  RecipeSearchMode,
} from '../../../src/common/constants';
import { PreferenceChange } from '../../../src/common/contracts';
import {
  FoodItemsNotFoundBadRequestException,
  RecipeNotFoundException,
} from '../../../src/common/exceptions';
import {
  Page,
  PageQuery,
  PreferenceChangeResult,
  RecipeSearchQuery,
} from '../../../src/common/types';
import { searchWords } from '../../../src/common/utils';
import { FoodItem } from '../../../src/generated/prisma/client';
import { FoodItemFilter } from '../../../src/modules/data-access/food-item/food-item.repository';
import {
  RecipeFilter,
  RecipeWithIngredients,
} from '../../../src/modules/data-access/recipe/recipe.repository';
import { ConversationWithMessages } from '../../../src/modules/data-access/conversation/conversation.repository';
import { MenuWithVersions } from '../../../src/modules/data-access/menu/menu.repository';
import { ChatToolsService } from '../../../src/modules/services/chat-tools/chat-tools.service';
import { ConversationService } from '../../../src/modules/services/conversation/conversation.service';
import { FoodItemService } from '../../../src/modules/services/food-item/food-item.service';
import { MenuService } from '../../../src/modules/services/menu/menu.service';
import { PreferenceChangeService } from '../../../src/modules/services/preference-change/preference-change.service';
import { NutritionService } from '../../../src/modules/services/nutrition/nutrition.service';
import { RecipeService } from '../../../src/modules/services/recipe/recipe.service';
import { buildRecipeDocument } from '../../../src/modules/services/recipe-search/recipe-document';
import {
  RecipeSearchResult,
  RecipeSearchService,
} from '../../../src/modules/services/recipe-search/recipe-search.service';

/*
 * The recipes and foods the chat tools read in the evals: a small fixed catalog in memory, so a
 * case does not need a database and its numbers stay the same. The tools, `NutritionService` and
 * the rules run as in the app; only the services that read the database are replaced (the recipe
 * search by a word match on the recipe documents, English and Ukrainian, instead of embeddings).
 */

const CREATED_AT = new Date('2026-01-01T00:00:00Z');

/** Per 100 g of the food in its state: kcal, protein, fat, carbs. */
const food = (
  n: number,
  name: string,
  nameUk: string,
  state: FoodState,
  [kcal, protein, fat, carbs]: [number, number, number, number],
): FoodItem => {
  const id = `f0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return {
    id,
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
    translations: [{ foodItemId: id, locale: 'uk', name: nameUk, updatedAt: CREATED_AT }],
  } as unknown as FoodItem;
};

export const CATALOG_FOODS = {
  chicken: food(
    1,
    'Chicken breast, cooked',
    'Куряче філе, приготоване',
    FoodState.Other,
    [165, 31, 3.6, 0],
  ),
  rice: food(2, 'Rice, white, boiled', 'Рис білий, варений', FoodState.Boiled, [130, 2.7, 0.3, 28]),
  lentils: food(3, 'Lentils, boiled', 'Сочевиця, варена', FoodState.Boiled, [116, 9, 0.4, 20]),
  chickpeas: food(4, 'Chickpeas, boiled', 'Нут, варений', FoodState.Boiled, [164, 8.9, 2.6, 27]),
  coconutMilk: food(
    5,
    'Coconut milk, canned',
    'Кокосове молоко, консервоване',
    FoodState.Other,
    [197, 2, 21, 3],
  ),
  oats: food(6, 'Oat flakes', 'Вівсяні пластівці', FoodState.Dried, [370, 13, 7, 60]),
  peanutButter: food(7, 'Peanut butter', 'Арахісова паста', FoodState.Other, [590, 25, 50, 12]),
  salmon: food(8, 'Salmon, baked', 'Лосось, запечений', FoodState.Other, [206, 22, 12, 0]),
  tomato: food(9, 'Tomato', 'Помідор', FoodState.Raw, [18, 0.9, 0.2, 3.9]),
  bread: food(10, 'Whole wheat bread', 'Цільнозерновий хліб', FoodState.Other, [250, 13, 3.4, 41]),
  yogurt: food(11, 'Greek yogurt, plain', 'Грецький йогурт', FoodState.Other, [97, 9, 5, 4]),
  spinach: food(12, 'Spinach', 'Шпинат', FoodState.Raw, [23, 2.9, 0.4, 3.6]),
  oliveOil: food(13, 'Olive oil', 'Оливкова олія', FoodState.Other, [884, 0, 100, 0]),
  tofu: food(14, 'Tofu, firm', 'Тофу', FoodState.Raw, [144, 15.8, 8.7, 2.8]),
  banana: food(15, 'Banana', 'Банан', FoodState.Raw, [89, 1.1, 0.3, 23]),
};

type FoodKey = keyof typeof CATALOG_FOODS;

const recipe = (
  n: number,
  [name, nameUk]: [string, string],
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
    translations: [
      {
        recipeId: id,
        locale: 'uk',
        name: nameUk,
        description: null,
        instructions: `Приготуйте: ${nameUk.toLowerCase()}.`,
        updatedAt: CREATED_AT,
      },
    ],
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
  recipe(1, ['Lentil soup', 'Суп із сочевиці'], MealType.Lunch, [...VEGAN, DietTag.GlutenFree], 2, [
    ['lentils', 400],
    ['tomato', 200],
    ['spinach', 100],
  ]),
  recipe(2, ['Chickpea curry', 'Карі з нуту'], MealType.Dinner, [...VEGAN, DietTag.GlutenFree], 2, [
    ['chickpeas', 300],
    ['coconutMilk', 200],
    ['tomato', 200],
    ['rice', 300],
  ]),
  recipe(
    3,
    ['Chicken with rice', 'Курка з рисом'],
    MealType.Lunch,
    [DietTag.HighProtein, DietTag.DairyFree],
    1,
    [
      ['chicken', 200],
      ['rice', 250],
    ],
  ),
  recipe(
    4,
    ['Baked salmon with spinach', 'Запечений лосось зі шпинатом'],
    MealType.Dinner,
    [DietTag.Pescatarian],
    1,
    [
      ['salmon', 180],
      ['spinach', 100],
      ['oliveOil', 5],
    ],
  ),
  recipe(
    5,
    ['Chicken salad', 'Курячий салат'],
    MealType.Lunch,
    [DietTag.HighProtein, DietTag.LowCarb],
    1,
    [
      ['chicken', 150],
      ['tomato', 150],
      ['spinach', 50],
      ['oliveOil', 10],
    ],
  ),
  recipe(6, ['Oatmeal with banana', 'Вівсянка з бананом'], MealType.Breakfast, VEGAN, 1, [
    ['oats', 80],
    ['banana', 100],
  ]),
  recipe(
    7,
    ['Yogurt bowl', 'Боул із йогуртом'],
    MealType.Breakfast,
    [DietTag.Vegetarian, DietTag.GlutenFree],
    1,
    [
      ['yogurt', 200],
      ['banana', 100],
    ],
  ),
  recipe(
    8,
    ['Peanut butter toast', 'Тост з арахісовою пастою'],
    MealType.Snack,
    VEGAN,
    1,
    [
      ['bread', 60],
      ['peanutButter', 30],
    ],
    ['peanut', 'gluten'],
  ),
  recipe(9, ['Tofu stir-fry with rice', 'Смажений тофу з рисом'], MealType.Dinner, VEGAN, 2, [
    ['tofu', 300],
    ['rice', 400],
    ['spinach', 100],
    ['oliveOil', 10],
  ]),
  recipe(
    10,
    ['Banana yogurt snack', 'Перекус із йогурту з бананом'],
    MealType.Snack,
    [DietTag.Vegetarian],
    1,
    [
      ['yogurt', 150],
      ['banana', 50],
    ],
  ),
  recipe(
    11,
    ['Grilled chicken with spinach', 'Курка на грилі зі шпинатом'],
    MealType.Dinner,
    [DietTag.HighProtein],
    1,
    [
      ['chicken', 220],
      ['spinach', 150],
      ['oliveOil', 10],
    ],
  ),
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

const words = (text: string): string[] =>
  (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length >= 3);

/** A crude stem: the first letters, so "курячого" finds "курячий" and "lentils" "lentil". */
const stem = (word: string): string => word.slice(0, Math.max(4, word.length - 3));

/**
 * `RecipeSearchService.search` on `CATALOG_RECIPES`: the recipes within the filters whose document
 * (`buildRecipeDocument`, Ukrainian included) has a word starting like a word of the query, most
 * such words first. Stands in for the embeddings, which need a model and a database.
 */
export const catalogRecipeSearchService = {
  search: async ({
    text,
    filters = {},
    limit = 10,
  }: RecipeSearchQuery): Promise<RecipeSearchResult> => {
    const stems = [...new Set(words(text).map(stem))];
    const ranked = CATALOG_RECIPES.filter(
      (item) =>
        (!filters.mealType || item.mealType === filters.mealType) &&
        (filters.dietTypeGroups ?? []).every((group) =>
          group.some((tag) => item.dietType.includes(tag)),
        ) &&
        !(filters.excludeAllergens ?? []).some((allergen) => item.allergens.includes(allergen)) &&
        (filters.maxPrepTimeMinutes === undefined ||
          (item.prepTimeMinutes ?? Infinity) <= filters.maxPrepTimeMinutes),
    )
      .map((item) => {
        const documentWords = words(buildRecipeDocument(item).content);
        const score = stems.filter((s) => documentWords.some((word) => word.startsWith(s))).length;
        return { recipe: item, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.recipe.name.localeCompare(b.recipe.name))
      .slice(0, limit);
    return {
      hits: ranked.map(({ recipe, score }, i) => ({
        recipe,
        score,
        semanticRank: i + 1,
        lexicalRank: null,
        similarity: null,
        allWords: false,
        match: true,
      })),
      mode: RecipeSearchMode.Hybrid,
      degraded: false,
      model: null,
      // A word of the query in a recipe: what the fake has to tell a match from none.
      matched: ranked.length > 0,
      timings: { embeddingMs: 0, databaseMs: 0, totalMs: 0 },
    };
  },
};

/** The reads of `FoodItemService` the tools use, on `CATALOG_FOODS`. */
export const catalogFoodItemService = {
  getPage: async (filter: FoodItemFilter, query: PageQuery): Promise<Page<FoodItem>> =>
    page(
      Object.values(CATALOG_FOODS).filter((item) =>
        searchWords(filter.search).every(
          (word) => contains(item.name, word) || contains(item.nameEn, word),
        ),
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

export const CATALOG_CONVERSATION_ID = 'c0000000-0000-4000-8000-000000000001';
export const CATALOG_MENU_ID = 'c0000000-0000-4000-8000-000000000002';
export const CATALOG_MENU_VERSION_ID = 'c0000000-0000-4000-8000-000000000003';

/**
 * The conversation `save_menu` reads: one reply that suggested the catalog menu, not saved yet. A
 * case decides whether there is a menu by its messages; the eval scores whether the model saves.
 */
export const catalogConversationService = {
  getById: async (): Promise<ConversationWithMessages> =>
    ({
      id: CATALOG_CONVERSATION_ID,
      messages: [
        {
          role: MessageRole.Assistant,
          menuVersionId: CATALOG_MENU_VERSION_ID,
          menuVersion: { menuId: CATALOG_MENU_ID, compositionSnapshot: {} },
        },
      ],
    }) as unknown as ConversationWithMessages,
};

const catalogMenu = (confirmedVersionId: string | null): MenuWithVersions =>
  ({
    id: CATALOG_MENU_ID,
    title: '2-day menu',
    confirmedVersionId,
    versions: [],
  }) as unknown as MenuWithVersions;

/** The menu of `catalogConversationService`: a draft until `save_menu` confirms it. */
export const catalogMenuService = {
  getById: async (): Promise<MenuWithVersions> => catalogMenu(null),
  confirm: async (): Promise<MenuWithVersions> => catalogMenu(CATALOG_MENU_VERSION_ID),
};

/** The change the latest reply of the catalog conversation proposed, for `apply_preference_change`. */
export const CATALOG_PENDING_CHANGE: PreferenceChange = {
  action: PreferenceChangeAction.Add,
  preferenceType: PreferenceType.Allergy,
  value: 'peanut',
};

/** Proposes any change, normalized, and applies the pending one; nothing is stored. */
export const catalogPreferenceChangeService = {
  propose: async (change: PreferenceChange): Promise<PreferenceChangeResult> => ({
    status: PreferenceChangeStatus.Proposed,
    change: { ...change, value: change.value.trim().toLowerCase() },
  }),
  applyInChat: async (): Promise<PreferenceChangeResult> => ({
    status: PreferenceChangeStatus.Applied,
    change: CATALOG_PENDING_CHANGE,
  }),
};

/** The chat tools of the app on the catalog. */
export const catalogChatTools = (): ChatToolsService =>
  new ChatToolsService(
    catalogRecipeService as unknown as RecipeService,
    catalogRecipeSearchService as unknown as RecipeSearchService,
    catalogFoodItemService as unknown as FoodItemService,
    new NutritionService(),
    catalogConversationService as unknown as ConversationService,
    catalogMenuService as unknown as MenuService,
    catalogPreferenceChangeService as unknown as PreferenceChangeService,
  );
