import { MENU_ID, PROFILE_ID } from '../../../test/fixtures';
import { createPrismaMock, PrismaMock } from '../../../test/prisma-mock';
import { MENU_INCLUDE, MenuRepository } from './menu.repository';

describe('MenuRepository', () => {
  let prisma: PrismaMock;
  let repository: MenuRepository;

  beforeEach(() => {
    prisma = createPrismaMock();
    repository = new MenuRepository(prisma);
  });

  it('lists the profile menus newest first with their version count', async () => {
    await repository.findAll(PROFILE_ID);

    expect(prisma.menu.findMany).toHaveBeenCalledWith({
      where: { profileId: PROFILE_ID },
      include: { _count: { select: { versions: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('loads one menu with versions, days and meals', async () => {
    await repository.findById(PROFILE_ID, MENU_ID);

    expect(prisma.menu.findFirst).toHaveBeenCalledWith({
      where: { id: MENU_ID, profileId: PROFILE_ID },
      include: MENU_INCLUDE,
    });
  });
});
