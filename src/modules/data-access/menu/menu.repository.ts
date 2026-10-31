import { Injectable } from '@nestjs/common';
import { MenuVersion, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../providers/prisma/prisma.service';
import { MenuGeneratedBy, MenuStatus, SortOrder } from '../../../common/constants';
import { MenuComposition, NutritionGoalSnapshot, ResolvedDay } from '../../../common/types';

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

export interface MenuVersionData {
  generatedBy: MenuGeneratedBy;
  /** The goal the version was built for; null without one. */
  nutritionGoal: NutritionGoalSnapshot | null;
  composition: MenuComposition;
  days: ResolvedDay[];
  notes?: string | null;
}

const STATUS_WHERE: Record<MenuStatus, Prisma.MenuWhereInput> = {
  [MenuStatus.Confirmed]: { confirmedVersionId: { not: null } },
  [MenuStatus.Draft]: { confirmedVersionId: null },
  [MenuStatus.All]: {},
};

const versionCreate = (
  versionNumber: number,
  version: MenuVersionData,
): Prisma.MenuVersionUncheckedCreateWithoutMenuInput => ({
  versionNumber,
  generatedBy: version.generatedBy,
  notes: version.notes ?? null,
  nutritionGoalsSnapshot: version.nutritionGoal
    ? (version.nutritionGoal as unknown as Prisma.InputJsonObject)
    : Prisma.JsonNull,
  compositionSnapshot: version.composition as unknown as Prisma.InputJsonObject,
  days: {
    create: version.days.map((day) => ({
      dayIndex: day.dayIndex,
      date: day.date,
      meals: {
        create: day.meals.map((meal, position) => ({
          position,
          mealType: meal.mealType,
          servings: meal.servings,
          recipeId: meal.recipeId,
          recipeSnapshot: meal.recipe as unknown as Prisma.InputJsonObject,
        })),
      },
    })),
  },
});

@Injectable()
export class MenuRepository {
  constructor(private readonly prisma: PrismaService) {}

  public async findAll(profileId: string, status: MenuStatus): Promise<MenuSummary[]> {
    return this.prisma.menu.findMany({
      where: { profileId, ...STATUS_WHERE[status] },
      include: { _count: { select: { versions: true } } },
      orderBy: { createdAt: SortOrder.Desc },
    });
  }

  public async findById(profileId: string, id: string): Promise<MenuWithVersions | null> {
    return this.prisma.menu.findFirst({ where: { id, profileId }, include: MENU_INCLUDE });
  }

  /**
   * A new unconfirmed menu with its version 1, linked to the conversation it was generated in, in
   * one transaction.
   */
  public async createDraft(
    profileId: string,
    title: string,
    version: MenuVersionData,
    conversationId: string,
  ): Promise<MenuVersion> {
    return this.prisma.$transaction(async (tx) => {
      const menu = await tx.menu.create({ data: { profileId, title } });
      const created = await tx.menuVersion.create({
        data: { menuId: menu.id, ...versionCreate(1, version) },
      });
      await tx.conversation.update({ where: { id: conversationId }, data: { menuId: menu.id } });
      return created;
    });
  }

  /** The next version of the menu, numbered after its latest one, in one transaction. */
  public async addVersion(menuId: string, version: MenuVersionData): Promise<MenuVersion> {
    return this.prisma.$transaction(async (tx) => {
      const { _max } = await tx.menuVersion.aggregate({
        where: { menuId },
        _max: { versionNumber: true },
      });
      const created = await tx.menuVersion.create({
        data: { menuId, ...versionCreate((_max.versionNumber ?? 0) + 1, version) },
      });
      await tx.menu.update({ where: { id: menuId }, data: { updatedAt: new Date() } });
      return created;
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
}
