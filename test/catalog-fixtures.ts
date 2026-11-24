import { FoodSource, RecipeSource } from '../src/common/constants';
import { PrismaService } from '../src/providers/prisma/prisma.service';

/** The catalog is read only through the API: the e2e tests write their foods and recipes here. */
export interface TestFood {
  name: string;
  nameEn?: string | null;
  state: string;
  kcalPer100g?: number | null;
  proteinG?: number | null;
  fatG?: number | null;
  carbsG?: number | null;
}

export interface TestRecipe {
  name: string;
  instructions?: string;
  description?: string | null;
  mealType: string;
  dietType?: string[];
  servings: number;
  prepTimeMinutes?: number | null;
  ingredients: Array<{
    foodItemId: string;
    quantityG: number;
    isOptional?: boolean;
    notes?: string | null;
  }>;
}

/** A manual food; returns its id. */
export async function createFood(prisma: PrismaService, food: TestFood): Promise<string> {
  const { id } = await prisma.foodItem.create({
    data: { ...food, source: FoodSource.Manual },
    select: { id: true },
  });
  return id;
}

/** A manual recipe with its ingredients in the given order; returns its id. */
export async function createRecipe(
  prisma: PrismaService,
  { ingredients, instructions = 'Cook.', ...recipe }: TestRecipe,
): Promise<string> {
  const { id } = await prisma.recipe.create({
    data: {
      ...recipe,
      instructions,
      source: RecipeSource.Manual,
      ingredients: {
        create: ingredients.map((ingredient, position) => ({ ...ingredient, position })),
      },
    },
    select: { id: true },
  });
  return id;
}
