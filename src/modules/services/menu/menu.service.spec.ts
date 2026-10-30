import {
  Goal,
  MealType,
  MenuGeneratedBy,
  MenuIssueCode,
  MenuIssueSeverity,
  MenuStatus,
} from '../../../common/constants';
import {
  MenuNotFoundException,
  MenuVersionNotFoundException,
  MenuViolatesRulesBadRequestException,
} from '../../../common/exceptions';
import { MenuComposition, MenuIssue, ProfileContext, ResolvedDay } from '../../../common/types';
import { createMock } from '../../../test/create-mock';
import {
  buildMenu,
  buildMenuVersion,
  buildProfile,
  buildRecipeSnapshot,
  CONVERSATION_ID,
  MENU_ID,
  MENU_VERSION_ID,
  PROFILE_ID,
} from '../../../test/fixtures';
import { MenuRepository } from '../../data-access/menu/menu.repository';
import { ProfileContextService } from '../profile-context/profile-context.service';
import { UserProfileService } from '../user-profile/user-profile.service';
import { MenuComposer } from './menu-composer';
import { MenuService } from './menu.service';

describe('MenuService', () => {
  let repository: jest.Mocked<MenuRepository>;
  let composer: jest.Mocked<MenuComposer>;
  let service: MenuService;
  const context: ProfileContext = {
    profileId: PROFILE_ID,
    goal: Goal.Maintain,
    nutritionGoal: null,
    rules: { diets: [], allergies: [], excludedIngredients: [], dislikedFoods: [] },
  };
  const menu = buildMenu({ versions: [buildMenuVersion()] });
  const issue = (overrides: Partial<MenuIssue> = {}): MenuIssue => ({
    severity: MenuIssueSeverity.Error,
    code: MenuIssueCode.Allergen,
    message: 'Day 1, lunch: contains peanut',
    ...overrides,
  });

  beforeEach(() => {
    repository = createMock<MenuRepository>();
    repository.findById.mockResolvedValue(menu);
    const profileService = createMock<UserProfileService>();
    profileService.getCurrent.mockResolvedValue(buildProfile());
    composer = createMock<MenuComposer>();
    const profileContextService = createMock<ProfileContextService>();
    profileContextService.get.mockResolvedValue(context);
    service = new MenuService(repository, profileService, composer, profileContextService);
  });

  it('lists the confirmed menus of the profile unless another status is asked for', async () => {
    repository.findAll.mockResolvedValue([]);

    await expect(service.getAll()).resolves.toEqual([]);
    await service.getAll(MenuStatus.Draft);

    expect(repository.findAll.mock.calls).toEqual([
      [PROFILE_ID, MenuStatus.Confirmed],
      [PROFILE_ID, MenuStatus.Draft],
    ]);
  });

  describe('saveGenerated', () => {
    const days: ResolvedDay[] = [
      {
        dayIndex: 0,
        date: null,
        meals: [
          { mealType: MealType.Lunch, servings: 1, recipeId: 'r', recipe: buildRecipeSnapshot() },
        ],
      },
      { dayIndex: 1, date: null, meals: [] },
    ];
    const composition = { days: [], dailyAverage: {}, issues: [] } as unknown as MenuComposition;
    const generated = { menu: composition, days, nutritionGoal: context.nutritionGoal };
    const version = {
      generatedBy: MenuGeneratedBy.Llm,
      nutritionGoal: null,
      composition,
      days,
    };

    beforeEach(() => {
      const saved = buildMenuVersion({ id: MENU_VERSION_ID, menuId: MENU_ID });
      repository.createDraft.mockResolvedValue(saved);
      repository.addVersion.mockResolvedValue(saved);
    });

    it('creates a draft menu linked to a conversation without one', async () => {
      await expect(
        service.saveGenerated({ id: CONVERSATION_ID, menuId: null }, generated),
      ).resolves.toEqual({ menuId: MENU_ID, versionId: MENU_VERSION_ID });

      expect(repository.createDraft).toHaveBeenCalledWith(
        PROFILE_ID,
        '2-day menu',
        version,
        CONVERSATION_ID,
      );
      expect(repository.addVersion).not.toHaveBeenCalled();
    });

    it('adds a version to the menu of the conversation', async () => {
      await expect(
        service.saveGenerated({ id: CONVERSATION_ID, menuId: MENU_ID }, generated),
      ).resolves.toEqual({ menuId: MENU_ID, versionId: MENU_VERSION_ID });

      expect(repository.addVersion).toHaveBeenCalledWith(MENU_ID, version);
      expect(repository.createDraft).not.toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('returns one menu of the profile', async () => {
      await expect(service.getById(MENU_ID)).resolves.toBe(menu);
      expect(repository.findById).toHaveBeenCalledWith(PROFILE_ID, MENU_ID);
    });

    it('fails for an unknown menu', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.getById(MENU_ID)).rejects.toBeInstanceOf(MenuNotFoundException);
    });
  });

  describe('confirm', () => {
    beforeEach(() => {
      repository.confirm.mockResolvedValue(menu);
    });

    it('confirms a version that still follows the rules', async () => {
      composer.revalidate.mockReturnValue([issue({ severity: MenuIssueSeverity.Warning })]);

      await expect(service.confirm(MENU_ID, MENU_VERSION_ID)).resolves.toBe(menu);
      expect(composer.revalidate).toHaveBeenCalledWith(menu.versions[0], context);
      expect(repository.confirm).toHaveBeenCalledWith(MENU_ID, MENU_VERSION_ID);
    });

    it('refuses a version that breaks the current rules', async () => {
      composer.revalidate.mockReturnValue([issue()]);

      await expect(service.confirm(MENU_ID, MENU_VERSION_ID)).rejects.toThrow(
        new MenuViolatesRulesBadRequestException(['Day 1, lunch: contains peanut']),
      );
      expect(repository.confirm).not.toHaveBeenCalled();
    });

    it('fails for an unknown version', async () => {
      await expect(service.confirm(MENU_ID, 'other')).rejects.toBeInstanceOf(
        MenuVersionNotFoundException,
      );
    });
  });

  it('renames and deletes a menu of the profile', async () => {
    repository.rename.mockResolvedValue(menu);

    await expect(service.rename(MENU_ID, 'New')).resolves.toBe(menu);
    await service.delete(MENU_ID);

    expect(repository.rename).toHaveBeenCalledWith(MENU_ID, 'New');
    expect(repository.delete).toHaveBeenCalledWith(MENU_ID);
  });

  it('does not rename or delete an unknown menu', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.rename(MENU_ID, 'New')).rejects.toBeInstanceOf(MenuNotFoundException);
    await expect(service.delete(MENU_ID)).rejects.toBeInstanceOf(MenuNotFoundException);
    expect(repository.delete).not.toHaveBeenCalled();
  });
});
