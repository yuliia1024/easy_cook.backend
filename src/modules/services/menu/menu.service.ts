import { Injectable } from '@nestjs/common';
import { generatedMenuTitle, MenuGeneratedBy, MenuStatus } from '../../../common/constants';
import { provenanceNote } from '../../../common/utils';
import {
  MenuNotFoundException,
  MenuVersionNotFoundException,
  MenuViolatesRulesBadRequestException,
} from '../../../common/exceptions';
import {
  MenuComposition,
  MenuIssue,
  ModelProvenance,
  NutritionGoalSnapshot,
  ResolvedDay,
} from '../../../common/types';
import {
  MenuRepository,
  MenuSummary,
  MenuVersionWithDays,
  MenuWithVersions,
} from '../../data-access/menu/menu.repository';
import { ProfileContextService } from '../profile-context/profile-context.service';
import { UserProfileService } from '../user-profile/user-profile.service';
import { MenuComposer } from './menu-composer';
import { errorsOf } from './menu-rules';

export interface GeneratedMenu {
  menu: MenuComposition;
  days: ResolvedDay[];
  nutritionGoal: NutritionGoalSnapshot | null;
  /** Written to the version's `notes` (`provenanceNote`). */
  generatedWith: ModelProvenance;
}

export interface SavedMenuVersion {
  menuId: string;
  versionId: string;
}

/**
 * Menus of the profile and their immutable versions. Menus are read, renamed and deleted here, and
 * a menu the chat generated is saved as a draft version; a version becomes the menu only through an
 * explicit `confirm`.
 */
@Injectable()
export class MenuService {
  constructor(
    private readonly menuRepository: MenuRepository,
    private readonly userProfileService: UserProfileService,
    private readonly menuComposer: MenuComposer,
    private readonly profileContextService: ProfileContextService,
  ) {}

  public async getAll(status: MenuStatus = MenuStatus.Confirmed): Promise<MenuSummary[]> {
    const profile = await this.userProfileService.getCurrent();
    return this.menuRepository.findAll(profile.id, status);
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
    this.assertNoErrors(
      this.menuComposer.revalidate(version, await this.profileContextService.get()),
    );
    return this.menuRepository.confirm(id, version.id);
  }

  /**
   * Saves a menu generated in the conversation as an unconfirmed version: a new menu, linked to the
   * conversation, when it has none, otherwise the next version of its menu. Its notes name the model
   * and the prompt version that planned it.
   */
  public async saveGenerated(
    conversation: { id: string; menuId: string | null },
    { menu, days, nutritionGoal, generatedWith }: GeneratedMenu,
  ): Promise<SavedMenuVersion> {
    const version = {
      generatedBy: MenuGeneratedBy.Llm,
      nutritionGoal,
      composition: menu,
      days,
      notes: provenanceNote(generatedWith),
    };
    if (conversation.menuId) {
      const saved = await this.menuRepository.addVersion(conversation.menuId, version);
      return { menuId: saved.menuId, versionId: saved.id };
    }
    const profile = await this.userProfileService.getCurrent();
    const saved = await this.menuRepository.createDraft(
      profile.id,
      generatedMenuTitle(days.length),
      version,
      conversation.id,
    );
    return { menuId: saved.menuId, versionId: saved.id };
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
