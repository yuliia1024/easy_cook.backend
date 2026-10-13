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
export type MenuSummary = Prisma.MenuGetPayload<{
  include: { _count: { select: { versions: true } } };
}>;

/** Read side only for now: menus are written by the AI flow (next stage). */
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
}
