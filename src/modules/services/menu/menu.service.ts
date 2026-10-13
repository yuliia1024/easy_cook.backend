import { Injectable } from '@nestjs/common';
import { MenuNotFoundException } from '../../../common/exceptions';
import {
  MenuRepository,
  MenuSummary,
  MenuWithVersions,
} from '../../data-access/menu/menu.repository';
import { UserProfileService } from '../user-profile/user-profile.service';

/** Read only until the AI flow starts creating menus. */
@Injectable()
export class MenuService {
  constructor(
    private readonly menuRepository: MenuRepository,
    private readonly userProfileService: UserProfileService,
  ) {}

  public async getAll(): Promise<MenuSummary[]> {
    const profile = await this.userProfileService.getCurrent();
    return this.menuRepository.findAll(profile.id);
  }

  public async getById(id: string): Promise<MenuWithVersions> {
    const profile = await this.userProfileService.getCurrent();
    const menu = await this.menuRepository.findById(profile.id, id);
    if (!menu) {
      throw new MenuNotFoundException();
    }
    return menu;
  }
}
