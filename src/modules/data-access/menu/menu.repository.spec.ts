import { SortOrder } from '../../../common/constants';
import { MENU_ID, PROFILE_ID } from '../../../test/fixtures';
import { createPrismaMock, PrismaMock } from '../../../test/prisma-mock';
import { MENU_INCLUDE, MenuRepository } from './menu.repository';

describe('MenuRepository', () => {
  let prisma: PrismaMock;
  let repository: MenuRepository;
  const VERSION_ID = '99999999-9999-4999-8999-999999999999';

  beforeEach(() => {
    prisma = createPrismaMock();
    repository = new MenuRepository(prisma);
  });

  it('lists the profile menus newest first with their version count', async () => {
    await repository.findAll(PROFILE_ID);

    expect(prisma.menu.findMany).toHaveBeenCalledWith({
      where: { profileId: PROFILE_ID },
      include: { _count: { select: { versions: true } } },
      orderBy: { createdAt: SortOrder.Desc },
    });
  });

  it('loads one menu with versions, days and meals', async () => {
    await repository.findById(PROFILE_ID, MENU_ID);

    expect(prisma.menu.findFirst).toHaveBeenCalledWith({
      where: { id: MENU_ID, profileId: PROFILE_ID },
      include: MENU_INCLUDE,
    });
  });

  it('confirms a version with the time', async () => {
    await repository.confirm(MENU_ID, VERSION_ID);

    expect(prisma.menu.update).toHaveBeenCalledWith({
      where: { id: MENU_ID },
      data: { confirmedVersionId: VERSION_ID, confirmedAt: expect.any(Date) },
      include: MENU_INCLUDE,
    });
  });

  it('renames and deletes', async () => {
    await repository.rename(MENU_ID, 'New');
    await repository.delete(MENU_ID);

    expect(prisma.menu.update).toHaveBeenCalledWith({
      where: { id: MENU_ID },
      data: { title: 'New' },
      include: MENU_INCLUDE,
    });
    expect(prisma.menu.delete).toHaveBeenCalledWith({ where: { id: MENU_ID } });
  });
});
