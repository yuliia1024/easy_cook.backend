import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { Page, PageQuery } from '../../../common/types';
import { PrismaService } from '../../../providers/prisma/prisma.service';

export const RECIPE_INCLUDE = {
  ingredients: {
    include: { foodItem: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.RecipeInclude;

export type RecipeWithIngredients = Prisma.RecipeGetPayload<{ include: typeof RECIPE_INCLUDE }>;
export type IngredientWithFood = RecipeWithIngredients['ingredients'][number];

export interface RecipeFilter {
  /** Case-insensitive substring of the name. */
  search?: string;
  mealType?: string;
  /** The recipe must have every one of these tags. */
  dietTypes?: string[];
}

export interface RecipeData {
  name: string;
  description?: string | null;
  instructions: string;
  mealType: string;
  dietType?: string[];
  servings: number;
  prepTimeMinutes?: number | null;
  source: string;
  sourceId?: string | null;
}

export interface IngredientData {
  foodItemId: string;
  quantityG: number;
  isOptional?: boolean;
  notes?: string | null;
}

@Injectable()
export class RecipeRepository {
  constructor(private readonly prisma: PrismaService) {}

  public async findPage(
    filter: RecipeFilter,
    { page, limit }: PageQuery,
  ): Promise<Page<RecipeWithIngredients>> {
    const where = this.where(filter);
    const [total, items] = await this.prisma.$transaction([
      this.prisma.recipe.count({ where }),
      this.prisma.recipe.findMany({
        where,
        include: RECIPE_INCLUDE,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { items, total };
  }

  public async findById(id: string): Promise<RecipeWithIngredients | null> {
    return this.prisma.recipe.findUnique({ where: { id }, include: RECIPE_INCLUDE });
  }

  public async findBySource(source: string, sourceId: string): Promise<{ id: string } | null> {
    return this.prisma.recipe.findUnique({
      where: { source_sourceId: { source, sourceId } },
      select: { id: true },
    });
  }

  /** Ingredients keep the given order. */
  public async create(
    data: RecipeData,
    ingredients: IngredientData[],
  ): Promise<RecipeWithIngredients> {
    return this.prisma.recipe.create({
      data: {
        ...data,
        ingredients: {
          create: ingredients.map((ingredient, position) => ({ ...ingredient, position })),
        },
      },
      include: RECIPE_INCLUDE,
    });
  }

  /** `ingredients`, when given, replace the whole list in the same transaction. */
  public async update(
    id: string,
    data: Partial<RecipeData>,
    ingredients?: IngredientData[],
  ): Promise<RecipeWithIngredients> {
    return this.prisma.$transaction(async (tx) => {
      if (ingredients) {
        await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });
      }
      return tx.recipe.update({
        where: { id },
        data: {
          ...data,
          ...(ingredients && {
            ingredients: {
              create: ingredients.map((ingredient, position) => ({ ...ingredient, position })),
            },
          }),
        },
        include: RECIPE_INCLUDE,
      });
    });
  }

  /** Ingredients go with it; menu meals keep their snapshot. */
  public async delete(id: string): Promise<void> {
    await this.prisma.recipe.delete({ where: { id } });
  }

  private where({ search, mealType, dietTypes }: RecipeFilter): Prisma.RecipeWhereInput {
    return {
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
      ...(mealType && { mealType }),
      ...(dietTypes?.length && { dietType: { hasEvery: dietTypes } }),
    };
  }
}
