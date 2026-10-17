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
