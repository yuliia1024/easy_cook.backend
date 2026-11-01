import {
  Conversation,
  DietaryPreference,
  FoodItem,
  Menu,
  Message,
  NutritionGoal,
  Prisma,
  RecipeIngredient,
  UserProfile,
} from '../generated/prisma/client';
import {
  ActivityLevel,
  CalculationMode,
  DietTag,
  FoodSource,
  FoodState,
  Goal,
  MealType,
  MenuGeneratedBy,
  MessageRole,
  PreferenceType,
  RecipeSource,
  Sex,
} from '../common/constants';
import { RecipeSnapshot } from '../common/types';
import {
  ConversationWithMessages,
  MessageWithMenu,
} from '../modules/data-access/conversation/conversation.repository';
import { MenuVersionWithDays, MenuWithVersions } from '../modules/data-access/menu/menu.repository';
import {
  IngredientWithFood,
  RecipeWithIngredients,
} from '../modules/data-access/recipe/recipe.repository';

export const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
export const FOOD_ID = '22222222-2222-4222-8222-222222222222';
export const RECIPE_ID = '33333333-3333-4333-8333-333333333333';
export const INGREDIENT_ID = '44444444-4444-4444-8444-444444444444';
export const MENU_ID = '55555555-5555-4555-8555-555555555555';
export const MENU_VERSION_ID = '99999999-9999-4999-8999-999999999999';
export const CONVERSATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const CREATED_AT = new Date('2026-01-01T00:00:00Z');
const UPDATED_AT = new Date('2026-01-02T00:00:00Z');
const d = (value: number): Prisma.Decimal => new Prisma.Decimal(value);

export function buildProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: PROFILE_ID,
    age: 30,
    heightCm: d(170),
    weightKg: d(65),
    sex: Sex.Female,
    activityLevel: ActivityLevel.Moderate,
    goal: Goal.Maintain,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

export function buildNutritionGoal(overrides: Partial<NutritionGoal> = {}): NutritionGoal {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    profileId: PROFILE_ID,
    caloriesKcal: d(2000),
    proteinG: d(104),
    fatG: d(56),
    carbsG: d(270),
    calculationMode: CalculationMode.Manual,
    ruleVersion: null,
    effectiveFrom: CREATED_AT,
    ...overrides,
  };
}

export function buildPreference(overrides: Partial<DietaryPreference> = {}): DietaryPreference {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    profileId: PROFILE_ID,
    preferenceType: PreferenceType.Allergy,
    value: 'peanut',
    ...overrides,
  };
}

/** Boiled white rice per 100 g. */
export function buildFoodItem(overrides: Partial<FoodItem> = {}): FoodItem {
  return {
    id: FOOD_ID,
    name: 'White rice, boiled',
    nameEn: 'Rice, white, boiled',
    kcalPer100g: d(130),
    proteinG: d(2.7),
    fatG: d(0.3),
    carbsG: d(28.2),
    state: FoodState.Boiled,
    source: FoodSource.Seed,
    sourceId: 'rice-white-boiled',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

export function buildIngredient(
  overrides: Partial<RecipeIngredient> & { foodItem?: FoodItem } = {},
): IngredientWithFood {
  const foodItem = overrides.foodItem ?? buildFoodItem();
  return {
    id: INGREDIENT_ID,
    recipeId: RECIPE_ID,
    foodItemId: foodItem.id,
    quantityG: d(200),
    isOptional: false,
    notes: null,
    position: 0,
    ...overrides,
    foodItem,
  };
}

export function buildRecipe(overrides: Partial<RecipeWithIngredients> = {}): RecipeWithIngredients {
  return {
    id: RECIPE_ID,
    name: 'Rice with vegetables',
    description: null,
    instructions: 'Boil the rice.',
    mealType: MealType.Lunch,
    dietType: [DietTag.Vegan],
    allergens: [],
    servings: 2,
    prepTimeMinutes: 20,
    source: RecipeSource.Manual,
    sourceId: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ingredients: [buildIngredient()],
    ...overrides,
  };
}

/** `buildRecipe()` as a menu version stores it: 200 g boiled rice, 2 servings. */
export function buildRecipeSnapshot(overrides: Partial<RecipeSnapshot> = {}): RecipeSnapshot {
  return {
    id: RECIPE_ID,
    name: 'Rice with vegetables',
    mealType: MealType.Lunch,
    dietType: [DietTag.Vegan],
    allergens: [],
    servings: 2,
    prepTimeMinutes: 20,
    perServing: { kcal: 130, proteinG: 2.7, fatG: 0.3, carbsG: 28.2 },
    complete: true,
    ingredients: [
      {
        foodItemId: FOOD_ID,
        foodName: 'White rice, boiled',
        foodNameEn: 'Rice, white, boiled',
        state: FoodState.Boiled,
        quantityG: 200,
        isOptional: false,
      },
    ],
    ...overrides,
  };
}

/** Version 1: one day with `buildRecipe()` for lunch, one serving. */
export function buildMenuVersion(
  overrides: Partial<MenuVersionWithDays> = {},
): MenuVersionWithDays {
  const dayId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  return {
    id: MENU_VERSION_ID,
    menuId: MENU_ID,
    versionNumber: 1,
    generatedBy: MenuGeneratedBy.Manual,
    nutritionGoalsSnapshot: null,
    compositionSnapshot: {
      days: [
        {
          dayIndex: 0,
          date: null,
          meals: [
            {
              position: 0,
              mealType: MealType.Lunch,
              recipeId: RECIPE_ID,
              recipeName: 'Rice with vegetables',
              servings: 1,
              nutrition: { kcal: 130, proteinG: 2.7, fatG: 0.3, carbsG: 28.2 },
              complete: true,
            },
          ],
          totals: { kcal: 130, proteinG: 2.7, fatG: 0.3, carbsG: 28.2 },
          complete: true,
        },
      ],
      dailyAverage: { kcal: 130, proteinG: 2.7, fatG: 0.3, carbsG: 28.2 },
      issues: [],
    },
    notes: null,
    createdAt: CREATED_AT,
    days: [
      {
        id: dayId,
        menuVersionId: MENU_VERSION_ID,
        dayIndex: 0,
        date: null,
        meals: [
          {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            menuDayId: dayId,
            mealType: MealType.Lunch,
            position: 0,
            recipeId: RECIPE_ID,
            servings: d(1),
            recipeSnapshot: buildRecipeSnapshot() as unknown as Prisma.JsonObject,
          },
        ],
      },
    ],
    ...overrides,
  };
}

export function buildMenu(overrides: Partial<MenuWithVersions> = {}): MenuWithVersions {
  const menu: Menu = {
    id: MENU_ID,
    profileId: PROFILE_ID,
    title: 'Week 1',
    confirmedVersionId: null,
    confirmedAt: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  };
  return { ...menu, versions: [], ...overrides };
}

export function buildMessage(overrides: Partial<MessageWithMenu> = {}): MessageWithMenu {
  const message: Message = {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    conversationId: CONVERSATION_ID,
    role: MessageRole.User,
    content: 'Plan a menu for 3 days',
    menuVersionId: null,
    createdAt: CREATED_AT,
  };
  return { ...message, menuVersion: null, ...overrides };
}

export function buildConversation(
  overrides: Partial<ConversationWithMessages> = {},
): ConversationWithMessages {
  const conversation: Conversation = {
    id: CONVERSATION_ID,
    profileId: PROFILE_ID,
    title: 'New conversation',
    menuId: null,
    menuRequest: null,
    summary: null,
    lastSummarizedMessageId: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  };
  return { ...conversation, messages: [], ...overrides };
}
