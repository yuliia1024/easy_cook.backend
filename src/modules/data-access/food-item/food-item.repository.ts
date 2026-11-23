import { Injectable } from '@nestjs/common';
import { FoodItem, Prisma } from '../../../generated/prisma/client';
import { Page, PageQuery } from '../../../common/types';
import { PrismaService } from '../../../providers/prisma/prisma.service';
import { QueryMode } from '../../../common/constants';
import { searchWords } from '../../../common/utils';

export const FOOD_ITEM_INCLUDE = { translations: true } satisfies Prisma.FoodItemInclude;

/** A food with its names in other languages (`Locale`). */
export type FoodItemWithTranslations = Prisma.FoodItemGetPayload<{
  include: typeof FOOD_ITEM_INCLUDE;
}>;

export interface FoodItemFilter {
  /** Every word is a case-insensitive substring of `name`, `name_en` or a translated name, in any order. */
  search?: string;
  state?: string;
  source?: string;
}

/** Null nutrient = unknown value. */
export interface FoodItemData {
  name: string;
  nameEn?: string | null;
  kcalPer100g?: number | null;
  proteinG?: number | null;
  fatG?: number | null;
  carbsG?: number | null;
  state: string;
  source: string;
  sourceId?: string | null;
}

@Injectable()
export class FoodItemRepository {
  constructor(private readonly prisma: PrismaService) {}

  public async findPage(
    filter: FoodItemFilter,
    { page, limit, sortOrder }: PageQuery,
  ): Promise<Page<FoodItemWithTranslations>> {
    const where = this.where(filter);
    const [total, items] = await this.prisma.$transaction([
      this.prisma.foodItem.count({ where }),
      this.prisma.foodItem.findMany({
        where,
        include: FOOD_ITEM_INCLUDE,
        orderBy: [{ name: sortOrder }, { id: sortOrder }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { items, total };
  }

  public async findById(id: string): Promise<FoodItemWithTranslations | null> {
    return this.prisma.foodItem.findUnique({ where: { id }, include: FOOD_ITEM_INCLUDE });
  }

  /** The foods of `ids` that exist. */
  public async findByIds(ids: string[]): Promise<FoodItem[]> {
    return this.prisma.foodItem.findMany({ where: { id: { in: ids } } });
  }

  public async isUsedInRecipes(id: string): Promise<boolean> {
    return (await this.prisma.recipeIngredient.count({ where: { foodItemId: id } })) > 0;
  }

  public async findBySource(source: string, sourceId: string): Promise<FoodItem | null> {
    return this.prisma.foodItem.findUnique({ where: { source_sourceId: { source, sourceId } } });
  }

  public async create(data: FoodItemData): Promise<FoodItemWithTranslations> {
    return this.prisma.foodItem.create({ data, include: FOOD_ITEM_INCLUDE });
  }

  /** A new `name` drops the translations of the old one. */
  public async update(id: string, data: Partial<FoodItemData>): Promise<FoodItemWithTranslations> {
    return this.prisma.foodItem.update({
      where: { id },
      data: {
        ...data,
        ...(data.name !== undefined && { translations: { deleteMany: {} } }),
      },
      include: FOOD_ITEM_INCLUDE,
    });
  }

  private where({ search, state, source }: FoodItemFilter): Prisma.FoodItemWhereInput {
    const words = searchWords(search);
    return {
      ...(words.length > 0 && {
        AND: words.map((word) => ({
          OR: [
            { name: { contains: word, mode: QueryMode.Insensitive } },
            { nameEn: { contains: word, mode: QueryMode.Insensitive } },
            {
              translations: {
                some: { name: { contains: word, mode: QueryMode.Insensitive } },
              },
            },
          ],
        })),
      }),
      ...(state && { state }),
      ...(source && { source }),
    };
  }
}
