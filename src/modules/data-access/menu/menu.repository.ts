import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../providers/prisma/prisma.service';
import { SortOrder } from '../../../common/constants';

export const MENU_INCLUDE = {
  versions: {
    orderBy: { versionNumber: SortOrder.Desc },
    include: {
      days: {
        orderBy: { dayIndex: SortOrder.Asc },
        include: { meals: { orderBy: { position: SortOrder.Asc } } },
      },
    },
  },
} satisfies Prisma.MenuInclude;

export type MenuWithVersions = Prisma.MenuGetPayload<{ include: typeof MENU_INCLUDE }>;
export type MenuVersionWithDays = MenuWithVersions['versions'][number];
export type MenuSummary = Prisma.MenuGetPayload<{
  include: { _count: { select: { versions: true } } };
}>;

export interface MenuMealData {
  mealType: string;
  recipeId: string | null;
  servings: number;
  recipeSnapshot: Prisma.InputJsonValue;
}

export interface MenuDayData {
  dayIndex: number;
  date: Date | null;
  /** In order; the index is the position. */
  meals: MenuMealData[];
}

export interface MenuVersionData {
  generatedBy: string;
  notes: string | null;
  /** `Prisma.JsonNull` when there was no goal. */
  nutritionGoalsSnapshot: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  compositionSnapshot: Prisma.InputJsonValue;
  days: MenuDayData[];
}

@Injectable()
export class MenuRepository {
  constructor(private readonly prisma: PrismaService) {}

  public async findAll(profileId: string): Promise<MenuSummary[]> {
    return this.prisma.menu.findMany({
      where: { profileId },
      include: { _count: { select: { versions: true } } },
      orderBy: { createdAt: SortOrder.Desc },
    });
  }

  public async findById(profileId: string, id: string): Promise<MenuWithVersions | null> {
    return this.prisma.menu.findFirst({ where: { id, profileId }, include: MENU_INCLUDE });
  }

  /** The menu with its first version. */
  public async create(
    profileId: string,
    title: string,
    version: MenuVersionData,
  ): Promise<MenuWithVersions> {
    return this.prisma.menu.create({
      data: {
        profileId,
        title,
        versions: { create: this.versionInput(1, version) },
      },
      include: MENU_INCLUDE,
    });
  }

  /**
   * Appends the next version number. Two concurrent appends hit the unique
   * (`menu_id`, `version_number`) and the later one fails with a conflict.
   */
  public async addVersion(menuId: string, version: MenuVersionData): Promise<MenuWithVersions> {
    return this.prisma.$transaction(async (tx) => {
      const { _max } = await tx.menuVersion.aggregate({
        where: { menuId },
        _max: { versionNumber: true },
      });
      return tx.menu.update({
        where: { id: menuId },
        data: {
          versions: { create: this.versionInput((_max.versionNumber ?? 0) + 1, version) },
        },
        include: MENU_INCLUDE,
      });
    });
  }

  public async confirm(menuId: string, versionId: string): Promise<MenuWithVersions> {
    return this.prisma.menu.update({
      where: { id: menuId },
      data: { confirmedVersionId: versionId, confirmedAt: new Date() },
      include: MENU_INCLUDE,
    });
  }

  public async rename(menuId: string, title: string): Promise<MenuWithVersions> {
    return this.prisma.menu.update({
      where: { id: menuId },
      data: { title },
      include: MENU_INCLUDE,
    });
  }

  /** Versions, days and meals go with it; conversations keep their messages. */
  public async delete(menuId: string): Promise<void> {
    await this.prisma.menu.delete({ where: { id: menuId } });
  }

  private versionInput(
    versionNumber: number,
    { days, ...version }: MenuVersionData,
  ): Prisma.MenuVersionCreateWithoutMenuInput {
    return {
      ...version,
      versionNumber,
      days: {
        create: days.map(({ meals, ...day }) => ({
          ...day,
          meals: {
            create: meals.map(({ recipeId, ...meal }, position) => ({
              ...meal,
              position,
              ...(recipeId && { recipe: { connect: { id: recipeId } } }),
            })),
          },
        })),
      },
    };
  }
}
