import { MenuStatus } from '../../../common/constants';
import { MenuService } from '../../../modules/services/menu/menu.service';
import { createMock } from '../../../test/create-mock';
import { buildMenu, buildMenuVersion, MENU_ID, MENU_VERSION_ID } from '../../../test/fixtures';
import { MenuControllerService } from './menu-controller.service';

describe('MenuControllerService', () => {
  let menuService: jest.Mocked<MenuService>;
  let service: MenuControllerService;
  const menu = buildMenu({ versions: [buildMenuVersion()] });

  beforeEach(() => {
    menuService = createMock<MenuService>();
    for (const method of ['getById', 'rename', 'confirm'] as const) {
      menuService[method].mockResolvedValue(menu);
    }
    service = new MenuControllerService(menuService);
  });

  it('maps the list', async () => {
    const { versions: _versions, ...summary } = buildMenu();
    menuService.getAll.mockResolvedValue([{ ...summary, _count: { versions: 2 } }]);

    await expect(service.getAll({ status: MenuStatus.All })).resolves.toEqual([
      expect.objectContaining({ id: MENU_ID, versionCount: 2 }),
    ]);
    expect(menuService.getAll).toHaveBeenCalledWith(MenuStatus.All);
  });

  it('maps one menu', async () => {
    await expect(service.getById(MENU_ID)).resolves.toMatchObject({
      id: MENU_ID,
      versions: [expect.objectContaining({ id: MENU_VERSION_ID })],
    });
    expect(menuService.getById).toHaveBeenCalledWith(MENU_ID);
  });

  it('renames, confirms and deletes', async () => {
    await service.rename(MENU_ID, { title: 'New' });
    await service.confirm(MENU_ID, MENU_VERSION_ID);
    await service.delete(MENU_ID);

    expect(menuService.rename).toHaveBeenCalledWith(MENU_ID, 'New');
    expect(menuService.confirm).toHaveBeenCalledWith(MENU_ID, MENU_VERSION_ID);
    expect(menuService.delete).toHaveBeenCalledWith(MENU_ID);
  });
});
