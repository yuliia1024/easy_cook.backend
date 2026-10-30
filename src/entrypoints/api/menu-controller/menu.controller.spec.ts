import { MenuStatus } from '../../../common/constants';
import { createMock } from '../../../test/create-mock';
import { MENU_ID, MENU_VERSION_ID } from '../../../test/fixtures';
import { MenuControllerService } from './menu-controller.service';
import { MenuController } from './menu.controller';

describe('MenuController', () => {
  it('delegates to the service', async () => {
    const service = createMock<MenuControllerService>();
    const controller = new MenuController(service);

    await controller.getAll({ status: MenuStatus.Draft });
    await controller.getById(MENU_ID);
    await controller.rename(MENU_ID, { title: 'New' });
    await controller.delete(MENU_ID);
    await controller.confirm(MENU_ID, MENU_VERSION_ID);

    expect(service.getAll).toHaveBeenCalledWith({ status: MenuStatus.Draft });
    expect(service.getById).toHaveBeenCalledWith(MENU_ID);
    expect(service.rename).toHaveBeenCalledWith(MENU_ID, { title: 'New' });
    expect(service.delete).toHaveBeenCalledWith(MENU_ID);
    expect(service.confirm).toHaveBeenCalledWith(MENU_ID, MENU_VERSION_ID);
  });
});
