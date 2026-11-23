import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { Page, PageQuery } from '../../../common/types';
import { PrismaService } from '../../../providers/prisma/prisma.service';
import { QueryMode, SortOrder } from '../../../common/constants';

export const RECIPE_INCLUDE = {
  ingredients: {
    include: { foodItem: { include: { translations: true } }, translations: true },
    orderBy: [{ position: SortOrder.Asc }, { id: SortOrder.Asc }],
  },
  translations: true,
} satisfies Prisma.RecipeInclude;

export type RecipeWithIngredients = Prisma.RecipeGetPayload<{ include: typeof RECIPE_INCLUDE }>;
export type IngredientWithFood = RecipeWithIngredients['ingredients'][number];

export interface RecipeFilter {
  /** Case-insensitive substring of the name or of a translated name. */
  search?: string;
  mealType?: string;
  /** The recipe must have every one of these tags. */
  dietTypes?: string[];
  /** The recipe must have at least one tag of each group. */
  dietTypeGroups?: string[][];
}

@Injectable()
export class RecipeRepository {
  constructor(private readonly prisma: PrismaService) {}

  public async findPage(
    filter: RecipeFilter,
    { page, limit, sortOrder }: PageQuery,
  ): Promise<Page<RecipeWithIngredients>> {
    const where = this.where(filter);
    const [total, items] = await this.prisma.$transaction([
      this.prisma.recipe.count({ where }),
      this.prisma.recipe.findMany({
        where,
        include: RECIPE_INCLUDE,
        orderBy: [{ name: sortOrder }, { id: sortOrder }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { items, total };
  }

  /** Every matching recipe, unpaged, ordered by name. */
  public async findAll(filter: RecipeFilter): Promise<RecipeWithIngredients[]> {
    return this.prisma.recipe.findMany({
      where: this.where(filter),
      include: RECIPE_INCLUDE,
      orderBy: [{ name: SortOrder.Asc }, { id: SortOrder.Asc }],
    });
  }

  /** In no particular order; unknown ids are left out. */
  public async findByIds(ids: string[]): Promise<RecipeWithIngredients[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.prisma.recipe.findMany({ where: { id: { in: ids } }, include: RECIPE_INCLUDE });
  }

  public async findById(id: string): Promise<RecipeWithIngredients | null> {
    return this.prisma.recipe.findUnique({ where: { id }, include: RECIPE_INCLUDE });
  }

  private where({
    search,
    mealType,
    dietTypes,
    dietTypeGroups,
  }: RecipeFilter): Prisma.RecipeWhereInput {
    return {
      ...(search && {
        OR: [
          { name: { contains: search, mode: QueryMode.Insensitive } },
          {
            translations: {
              some: { name: { contains: search, mode: QueryMode.Insensitive } },
            },
          },
        ],
      }),
      ...(mealType && { mealType }),
      ...(dietTypes?.length && { dietType: { hasEvery: dietTypes } }),
      ...(dietTypeGroups?.length && {
        AND: dietTypeGroups.map((tags) => ({ dietType: { hasSome: tags } })),
      }),
    };
  }
}
