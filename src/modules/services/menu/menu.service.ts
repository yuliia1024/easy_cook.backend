import { Injectable } from '@nestjs/common';
import {
  MenuNotFoundException,
  MenuVersionNotFoundException,
  MenuViolatesRulesBadRequestException,
} from '../../../common/exceptions';
import { MenuIssue } from '../../../common/types';
import {
  MenuRepository,
  MenuSummary,
  MenuVersionWithDays,
  MenuWithVersions,
} from '../../data-access/menu/menu.repository';
import { UserProfileService } from '../user-profile/user-profile.service';
import { MenuComposer } from './menu-composer';
import { errorsOf } from './menu-rules';

/**
 * Menus of the profile and their immutable versions. Menus are read, renamed and deleted here; a
 * version becomes the menu only through an explicit `confirm`.
 */
@Injectable()
export class MenuService {
  constructor(
    private readonly menuRepository: MenuRepository,
    private readonly userProfileService: UserProfileService,
    private readonly menuComposer: MenuComposer,
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

  /**
   * Makes the version the confirmed menu. It is checked again first, since the preferences may
   * have changed since it was built: a version that breaks a hard rule cannot be confirmed.
   */
  public async confirm(id: string, versionId: string): Promise<MenuWithVersions> {
    const menu = await this.getById(id);
    const version = this.findVersion(menu, versionId);
    this.assertNoErrors(this.menuComposer.revalidate(version, await this.menuComposer.context()));
    return this.menuRepository.confirm(id, version.id);
  }

  public async rename(id: string, title: string): Promise<MenuWithVersions> {
    await this.getById(id);
    return this.menuRepository.rename(id, title);
  }

  public async delete(id: string): Promise<void> {
    await this.getById(id);
    await this.menuRepository.delete(id);
  }

  private findVersion(menu: MenuWithVersions, versionId: string): MenuVersionWithDays {
    const version = menu.versions.find((v) => v.id === versionId);
    if (!version) {
      throw new MenuVersionNotFoundException();
    }
    return version;
  }

  /** 400 when a hard rule is broken. */
  private assertNoErrors(issues: MenuIssue[]): void {
    const errors = errorsOf(issues);
    if (errors.length > 0) {
      throw new MenuViolatesRulesBadRequestException(errors.map((issue) => issue.message));
    }
  }
}
