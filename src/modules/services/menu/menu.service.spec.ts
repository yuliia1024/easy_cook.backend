import { MenuNotFoundException } from '../../../common/exceptions';
import { createMock } from '../../../test/create-mock';
import { buildMenu, buildProfile, MENU_ID, PROFILE_ID } from '../../../test/fixtures';
import { MenuRepository } from '../../data-access/menu/menu.repository';
import { UserProfileService } from '../user-profile/user-profile.service';
import { MenuService } from './menu.service';

describe('MenuService', () => {
  let repository: jest.Mocked<MenuRepository>;
  let service: MenuService;

  beforeEach(() => {
    repository = createMock<MenuRepository>();
    const profileService = createMock<UserProfileService>();
    profileService.getCurrent.mockResolvedValue(buildProfile());
    service = new MenuService(repository, profileService);
  });

  it('lists the profile menus', async () => {
    repository.findAll.mockResolvedValue([]);

    await expect(service.getAll()).resolves.toEqual([]);
    expect(repository.findAll).toHaveBeenCalledWith(PROFILE_ID);
  });

  it('returns one menu of the profile', async () => {
    const menu = buildMenu();
    repository.findById.mockResolvedValue(menu);

    await expect(service.getById(MENU_ID)).resolves.toBe(menu);
    expect(repository.findById).toHaveBeenCalledWith(PROFILE_ID, MENU_ID);
  });

  it('fails for an unknown menu', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.getById(MENU_ID)).rejects.toBeInstanceOf(MenuNotFoundException);
  });
});
