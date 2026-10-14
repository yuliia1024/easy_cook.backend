import { Injectable } from '@nestjs/common';
import {
  DEFAULT_MENU_MEAL_TYPES,
  MealType,
  MenuGeneratedBy,
  MenuIssueCode,
} from '../../../common/constants';
import {
  DuplicateMenuDayBadRequestException,
  MenuNotFoundException,
  MenuVersionNotFoundException,
  MenuViolatesRulesBadRequestException,
  RecipesNotFoundBadRequestException,
} from '../../../common/exceptions';
import { MenuDayDraft, MenuIssue } from '../../../common/types';
import {
  MenuRepository,
  MenuSummary,
  MenuVersionData,
  MenuVersionWithDays,
  MenuWithVersions,
} from '../../data-access/menu/menu.repository';
import { UserProfileService } from '../user-profile/user-profile.service';
import { MenuComposer, MenuContext } from './menu-composer';
import { toDraft } from './menu-composition';
import { MenuPlanner } from './menu-planner';
import { errorsOf } from './menu-rules';

export interface ManualMenuData {
  notes: string | null;
  days: MenuDayDraft[];
}

export interface GenerateMenuData {
  title: string | null;
  days: number;
  mealTypes: MealType[] | null;
  startDate: Date | null;
  instructions: string | null;
}

export interface ReplaceMealData {
  /** The version to start from; the latest when null. */
  versionId: string | null;
  dayIndex: number;
  position: number;
  instructions: string | null;
}

/**
 * Menus of the profile. Every change adds an immutable version (manual edits, generated menus,
 * replaced meals); a version becomes the menu only through an explicit `confirm`.
 */
@Injectable()
export class MenuService {
  constructor(
    private readonly menuRepository: MenuRepository,
    private readonly userProfileService: UserProfileService,
    private readonly menuComposer: MenuComposer,
    private readonly menuPlanner: MenuPlanner,
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

  /** A menu put together by hand: every meal must exist and follow the profile rules. */
  public async create(title: string, data: ManualMenuData): Promise<MenuWithVersions> {
    const context = await this.menuComposer.context();
    const version = await this.buildManual(data, context);
    return this.menuRepository.create(context.profileId, title, version);
  }

  /** The whole next version, as edited by hand. */
  public async addVersion(id: string, data: ManualMenuData): Promise<MenuWithVersions> {
    await this.getById(id);
    const version = await this.buildManual(data, await this.menuComposer.context());
    return this.menuRepository.addVersion(id, version);
  }

  /** A new menu planned by the assistant for the current goal; 404 without a goal. */
  public async generate(data: GenerateMenuData): Promise<MenuWithVersions> {
    const context = await this.menuComposer.context();
    const planned = await this.menuPlanner.plan(
      {
        days: data.days,
        mealTypes: data.mealTypes ?? [...DEFAULT_MENU_MEAL_TYPES],
        startDate: data.startDate,
        instructions: data.instructions,
      },
      context,
    );
    return this.menuRepository.create(
      context.profileId,
      data.title ?? planned.title,
      planned.version,
    );
  }

  /** A new version where the assistant picked another recipe for one meal. */
  public async replaceMeal(id: string, data: ReplaceMealData): Promise<MenuWithVersions> {
    const menu = await this.getById(id);
    const base = this.findVersion(menu, data.versionId);
    const version = await this.menuPlanner.replaceMeal(
      toDraft(base),
      { dayIndex: data.dayIndex, position: data.position, instructions: data.instructions },
      await this.menuComposer.context(),
    );
    return this.menuRepository.addVersion(id, version);
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

  /** The given version of the menu, or its latest one. */
  private findVersion(menu: MenuWithVersions, versionId: string | null): MenuVersionWithDays {
    const version = versionId ? menu.versions.find((v) => v.id === versionId) : menu.versions[0];
    if (!version) {
      throw new MenuVersionNotFoundException();
    }
    return version;
  }

  private async buildManual(data: ManualMenuData, context: MenuContext): Promise<MenuVersionData> {
    const seen = new Set<number>();
    for (const day of data.days) {
      if (seen.has(day.dayIndex)) {
        throw new DuplicateMenuDayBadRequestException(day.dayIndex);
      }
      seen.add(day.dayIndex);
    }

    const built = await this.menuComposer.build(data.days, context, {
      generatedBy: MenuGeneratedBy.Manual,
      notes: data.notes,
    });
    this.assertNoErrors(built.issues);
    return built.version!;
  }

  /** 400 for unknown recipes first, then for broken rules. */
  private assertNoErrors(issues: MenuIssue[]): void {
    const errors = errorsOf(issues);
    const missing = errors.filter((issue) => issue.code === MenuIssueCode.RecipeNotFound);
    if (missing.length > 0) {
      throw new RecipesNotFoundBadRequestException(missing.map((issue) => issue.recipeId!));
    }
    if (errors.length > 0) {
      throw new MenuViolatesRulesBadRequestException(errors.map((issue) => issue.message));
    }
  }
}
