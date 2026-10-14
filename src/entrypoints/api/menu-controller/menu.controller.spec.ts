import { pipeUIMessageStreamToResponse } from 'ai';
import { Response } from 'express';
import { createMock } from '../../../test/create-mock';
import { MENU_ID, MENU_VERSION_ID } from '../../../test/fixtures';
import { MenuControllerService } from './menu-controller.service';
import { MenuController } from './menu.controller';

jest.mock('ai', () => ({ pipeUIMessageStreamToResponse: jest.fn() }));

describe('MenuController', () => {
  it('delegates to the service', async () => {
    const service = createMock<MenuControllerService>();
    const controller = new MenuController(service);
    const version = { days: [] };
    const replace = { dayIndex: 0, position: 0 };

    await controller.getAll();
    await controller.getById(MENU_ID);
    await controller.create({ title: 'Week', ...version });
    await controller.generate({ days: 3 }, createMock<Response>());
    await controller.rename(MENU_ID, { title: 'New' });
    await controller.delete(MENU_ID);
    await controller.addVersion(MENU_ID, version);
    await controller.confirm(MENU_ID, MENU_VERSION_ID);
    await controller.replaceMeal(MENU_ID, replace);

    expect(service.getAll).toHaveBeenCalled();
    expect(service.getById).toHaveBeenCalledWith(MENU_ID);
    expect(service.create).toHaveBeenCalledWith({ title: 'Week', ...version });
    expect(service.generate).toHaveBeenCalledWith();
    expect(service.rename).toHaveBeenCalledWith(MENU_ID, { title: 'New' });
    expect(service.delete).toHaveBeenCalledWith(MENU_ID);
    expect(service.addVersion).toHaveBeenCalledWith(MENU_ID, version);
    expect(service.confirm).toHaveBeenCalledWith(MENU_ID, MENU_VERSION_ID);
    expect(service.replaceMeal).toHaveBeenCalledWith(MENU_ID, replace);
  });

  it('pipes the generation stream to the response with 201', async () => {
    const service = createMock<MenuControllerService>();
    const stream = new ReadableStream();
    service.generate.mockReturnValue(stream);
    const response = createMock<Response>();

    await new MenuController(service).generate({ days: 1 }, response);

    expect(pipeUIMessageStreamToResponse).toHaveBeenCalledWith({ response, status: 201, stream });
  });
});
