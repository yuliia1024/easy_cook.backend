import {
  DietaryPreference,
  FoodItem,
  Menu,
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
  PreferenceType,
  RecipeSource,
  Sex,
} from '../common/constants';
import { MenuWithVersions } from '../modules/data-access/menu/menu.repository';
import {
  IngredientWithFood,
  RecipeWithIngredients,
} from '../modules/data-access/recipe/recipe.repository';

export const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
export const FOOD_ID = '22222222-2222-4222-8222-222222222222';
export const RECIPE_ID = '33333333-3333-4333-8333-333333333333';
export const INGREDIENT_ID = '44444444-4444-4444-8444-444444444444';
export const MENU_ID = '55555555-5555-4555-8555-555555555555';

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
    name: 'Рис білий варений',
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
    name: 'Рис з овочами',
    description: null,
    instructions: 'Зварити рис.',
    mealType: MealType.Lunch,
    dietType: [DietTag.Vegan],
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

export function buildMenu(overrides: Partial<MenuWithVersions> = {}): MenuWithVersions {
  const menu: Menu = {
    id: MENU_ID,
    profileId: PROFILE_ID,
    title: 'Тиждень 1',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  };
  return { ...menu, versions: [], ...overrides };
}
