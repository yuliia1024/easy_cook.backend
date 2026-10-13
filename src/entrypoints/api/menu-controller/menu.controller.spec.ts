import { createMock } from '../../../test/create-mock';
import { MENU_ID } from '../../../test/fixtures';
import { MenuControllerService } from './menu-controller.service';
import { MenuController } from './menu.controller';

describe('MenuController', () => {
  it('delegates to the service', async () => {
    const service = createMock<MenuControllerService>();
    const controller = new MenuController(service);

    await controller.getAll();
    await controller.getById(MENU_ID);

    expect(service.getAll).toHaveBeenCalled();
    expect(service.getById).toHaveBeenCalledWith(MENU_ID);
  });
});
