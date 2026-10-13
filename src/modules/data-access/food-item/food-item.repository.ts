import { Injectable } from '@nestjs/common';
import { FoodItem, Prisma } from '../../../generated/prisma/client';
import { Page, PageQuery } from '../../../common/types';
import { PrismaService } from '../../../providers/prisma/prisma.service';

export interface FoodItemFilter {
  /** Case-insensitive substring of `name` or `name_en`. */
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
    { page, limit }: PageQuery,
  ): Promise<Page<FoodItem>> {
    const where = this.where(filter);
    const [total, items] = await this.prisma.$transaction([
      this.prisma.foodItem.count({ where }),
      this.prisma.foodItem.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { items, total };
  }

  public async findById(id: string): Promise<FoodItem | null> {
    return this.prisma.foodItem.findUnique({ where: { id } });
  }

  /** The subset of `ids` that exist. */
  public async findExistingIds(ids: string[]): Promise<string[]> {
    const rows = await this.prisma.foodItem.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  public async findBySource(source: string, sourceId: string): Promise<FoodItem | null> {
    return this.prisma.foodItem.findUnique({ where: { source_sourceId: { source, sourceId } } });
  }

  public async create(data: FoodItemData): Promise<FoodItem> {
    return this.prisma.foodItem.create({ data });
  }

  public async update(id: string, data: Partial<FoodItemData>): Promise<FoodItem> {
    return this.prisma.foodItem.update({ where: { id }, data });
  }

  private where({ search, state, source }: FoodItemFilter): Prisma.FoodItemWhereInput {
    return {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { nameEn: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(state && { state }),
      ...(source && { source }),
    };
  }
}
