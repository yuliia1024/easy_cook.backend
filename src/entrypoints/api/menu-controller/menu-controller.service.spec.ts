import { MenuService } from '../../../modules/services/menu/menu.service';
import { createMock } from '../../../test/create-mock';
import { buildMenu, MENU_ID } from '../../../test/fixtures';
import { MenuControllerService } from './menu-controller.service';

describe('MenuControllerService', () => {
  let menuService: jest.Mocked<MenuService>;
  let service: MenuControllerService;

  beforeEach(() => {
    menuService = createMock<MenuService>();
    service = new MenuControllerService(menuService);
  });

  it('maps the list', async () => {
    const { versions: _versions, ...menu } = buildMenu();
    menuService.getAll.mockResolvedValue([{ ...menu, _count: { versions: 2 } }]);

    await expect(service.getAll()).resolves.toEqual([
      expect.objectContaining({ id: MENU_ID, versionCount: 2 }),
    ]);
  });

  it('maps one menu', async () => {
    menuService.getById.mockResolvedValue(buildMenu());

    await expect(service.getById(MENU_ID)).resolves.toMatchObject({ id: MENU_ID, versions: [] });
    expect(menuService.getById).toHaveBeenCalledWith(MENU_ID);
  });
});
