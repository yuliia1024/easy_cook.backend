import { createMock } from '../../../test/create-mock';
import { MENU_ID, MENU_VERSION_ID } from '../../../test/fixtures';
import { MenuControllerService } from './menu-controller.service';
import { MenuController } from './menu.controller';

describe('MenuController', () => {
  it('delegates to the service', async () => {
    const service = createMock<MenuControllerService>();
    const controller = new MenuController(service);
    const version = { days: [] };
    const generate = { days: 3 };
    const replace = { dayIndex: 0, position: 0 };

    await controller.getAll();
    await controller.getById(MENU_ID);
    await controller.create({ title: 'Week', ...version });
    await controller.generate(generate);
    await controller.rename(MENU_ID, { title: 'New' });
    await controller.delete(MENU_ID);
    await controller.addVersion(MENU_ID, version);
    await controller.confirm(MENU_ID, MENU_VERSION_ID);
    await controller.replaceMeal(MENU_ID, replace);

    expect(service.getAll).toHaveBeenCalled();
    expect(service.getById).toHaveBeenCalledWith(MENU_ID);
    expect(service.create).toHaveBeenCalledWith({ title: 'Week', ...version });
    expect(service.generate).toHaveBeenCalledWith(generate);
    expect(service.rename).toHaveBeenCalledWith(MENU_ID, { title: 'New' });
    expect(service.delete).toHaveBeenCalledWith(MENU_ID);
    expect(service.addVersion).toHaveBeenCalledWith(MENU_ID, version);
    expect(service.confirm).toHaveBeenCalledWith(MENU_ID, MENU_VERSION_ID);
    expect(service.replaceMeal).toHaveBeenCalledWith(MENU_ID, replace);
  });
});
