import { UIMessageChunk } from 'ai';
import { MealType } from '../../../common/constants';
import { MenuService } from '../../../modules/services/menu/menu.service';
import { createMock } from '../../../test/create-mock';
import {
  buildMenu,
  buildMenuVersion,
  MENU_ID,
  MENU_VERSION_ID,
  RECIPE_ID,
} from '../../../test/fixtures';
import { MenuControllerService } from './menu-controller.service';

const read = async (stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> => {
  const chunks: UIMessageChunk[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<UIMessageChunk>) {
    chunks.push(chunk);
  }
  return chunks;
};

describe('MenuControllerService', () => {
  let menuService: jest.Mocked<MenuService>;
  let service: MenuControllerService;
  const menu = buildMenu({ versions: [buildMenuVersion()] });
  const meal = { mealType: MealType.Lunch, recipeId: RECIPE_ID, servings: 1 };

  beforeEach(() => {
    menuService = createMock<MenuService>();
    for (const method of [
      'getById',
      'create',
      'rename',
      'addVersion',
      'confirm',
      'replaceMeal',
    ] as const) {
      menuService[method].mockResolvedValue(menu);
    }
    service = new MenuControllerService(menuService);
  });

  it('maps the list', async () => {
    const { versions: _versions, ...summary } = buildMenu();
    menuService.getAll.mockResolvedValue([{ ...summary, _count: { versions: 2 } }]);

    await expect(service.getAll()).resolves.toEqual([
      expect.objectContaining({ id: MENU_ID, versionCount: 2 }),
    ]);
  });

  it('maps one menu', async () => {
    await expect(service.getById(MENU_ID)).resolves.toMatchObject({
      id: MENU_ID,
      versions: [expect.objectContaining({ id: MENU_VERSION_ID })],
    });
    expect(menuService.getById).toHaveBeenCalledWith(MENU_ID);
  });

  it('creates a manual menu with dates as UTC midnights', async () => {
    await service.create({
      title: 'Week',
      notes: '',
      days: [
        { dayIndex: 0, date: '2026-10-20', meals: [meal] },
        { dayIndex: 1, meals: [meal] },
      ],
    });

    expect(menuService.create).toHaveBeenCalledWith('Week', {
      notes: null,
      days: [
        { dayIndex: 0, date: new Date('2026-10-20T00:00:00.000Z'), meals: [meal] },
        { dayIndex: 1, date: null, meals: [meal] },
      ],
    });
  });

  it('adds a version', async () => {
    await service.addVersion(MENU_ID, { notes: 'v2', days: [{ dayIndex: 0, meals: [meal] }] });

    expect(menuService.addVersion).toHaveBeenCalledWith(MENU_ID, {
      notes: 'v2',
      days: [{ dayIndex: 0, date: null, meals: [meal] }],
    });
  });

  it('streams that generation is not implemented yet', async () => {
    const chunks = await read(service.generate());

    expect(chunks).toEqual([
      expect.objectContaining({ type: 'start' }),
      { type: 'error', errorText: 'Menu generation is not implemented yet' },
    ]);
    expect(menuService.generate).not.toHaveBeenCalled();
  });

  it('replaces a meal', async () => {
    await service.replaceMeal(MENU_ID, { dayIndex: 0, position: 1 });

    expect(menuService.replaceMeal).toHaveBeenCalledWith(MENU_ID, {
      versionId: null,
      dayIndex: 0,
      position: 1,
      instructions: null,
    });
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
