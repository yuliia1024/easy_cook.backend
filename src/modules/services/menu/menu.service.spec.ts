import {
  MealType,
  MenuGeneratedBy,
  MenuIssueCode,
  MenuIssueSeverity,
} from '../../../common/constants';
import {
  DuplicateMenuDayBadRequestException,
  MenuNotFoundException,
  MenuVersionNotFoundException,
  MenuViolatesRulesBadRequestException,
  RecipesNotFoundBadRequestException,
} from '../../../common/exceptions';
import { MenuDayDraft, MenuIssue } from '../../../common/types';
import { createMock } from '../../../test/create-mock';
import {
  buildMenu,
  buildMenuVersion,
  buildProfile,
  MENU_ID,
  MENU_VERSION_ID,
  PROFILE_ID,
  RECIPE_ID,
} from '../../../test/fixtures';
import { MenuRepository, MenuVersionData } from '../../data-access/menu/menu.repository';
import { UserProfileService } from '../user-profile/user-profile.service';
import { MenuComposer, MenuContext } from './menu-composer';
import { MenuPlanner } from './menu-planner';
import { MenuService } from './menu.service';

describe('MenuService', () => {
  let repository: jest.Mocked<MenuRepository>;
  let composer: jest.Mocked<MenuComposer>;
  let planner: jest.Mocked<MenuPlanner>;
  let service: MenuService;
  const context: MenuContext = {
    profileId: PROFILE_ID,
    goal: null,
    rules: { diets: [], allergies: [], excludedIngredients: [], dislikedFoods: [] },
  };
  const version = { generatedBy: MenuGeneratedBy.Manual } as unknown as MenuVersionData;
  const menu = buildMenu({ versions: [buildMenuVersion()] });
  const days: MenuDayDraft[] = [
    {
      dayIndex: 0,
      date: null,
      meals: [{ mealType: MealType.Lunch, recipeId: RECIPE_ID, servings: 1 }],
    },
  ];
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
    composer.context.mockResolvedValue(context);
    composer.build.mockResolvedValue({ version, issues: [] });
    planner = createMock<MenuPlanner>();
    service = new MenuService(repository, profileService, composer, planner);
  });

  it('lists the profile menus', async () => {
    repository.findAll.mockResolvedValue([]);

    await expect(service.getAll()).resolves.toEqual([]);
    expect(repository.findAll).toHaveBeenCalledWith(PROFILE_ID);
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

  describe('create', () => {
    it('builds a manual version and saves the menu', async () => {
      repository.create.mockResolvedValue(menu);

      await expect(service.create('Week', { notes: 'n', days })).resolves.toBe(menu);
      expect(composer.build).toHaveBeenCalledWith(days, context, {
        generatedBy: MenuGeneratedBy.Manual,
        notes: 'n',
      });
      expect(repository.create).toHaveBeenCalledWith(PROFILE_ID, 'Week', version);
    });

    it('saves a menu with warnings', async () => {
      composer.build.mockResolvedValue({
        version,
        issues: [issue({ severity: MenuIssueSeverity.Warning })],
      });

      await service.create('Week', { notes: null, days });
      expect(repository.create).toHaveBeenCalled();
    });

    it('rejects broken rules', async () => {
      composer.build.mockResolvedValue({ version, issues: [issue()] });

      await expect(service.create('Week', { notes: null, days })).rejects.toThrow(
        new MenuViolatesRulesBadRequestException(['Day 1, lunch: contains peanut']),
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rejects unknown recipes first', async () => {
      composer.build.mockResolvedValue({
        version: null,
        issues: [issue({ code: MenuIssueCode.RecipeNotFound, recipeId: 'gone' })],
      });

      await expect(service.create('Week', { notes: null, days })).rejects.toThrow(
        new RecipesNotFoundBadRequestException(['gone']),
      );
    });

    it('rejects a day listed twice', async () => {
      await expect(
        service.create('Week', { notes: null, days: [...days, ...days] }),
      ).rejects.toBeInstanceOf(DuplicateMenuDayBadRequestException);
      expect(composer.build).not.toHaveBeenCalled();
    });
  });

  describe('addVersion', () => {
    it('appends a manual version to an existing menu', async () => {
      repository.addVersion.mockResolvedValue(menu);

      await expect(service.addVersion(MENU_ID, { notes: null, days })).resolves.toBe(menu);
      expect(repository.addVersion).toHaveBeenCalledWith(MENU_ID, version);
    });

    it('fails for an unknown menu', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.addVersion(MENU_ID, { notes: null, days })).rejects.toBeInstanceOf(
        MenuNotFoundException,
      );
    });
  });

  describe('generate', () => {
    const data = {
      title: null,
      days: 3,
      mealTypes: null,
      startDate: null,
      instructions: null,
    };

    beforeEach(() => {
      planner.plan.mockResolvedValue({ title: 'Menu for 3 days', version });
      repository.create.mockResolvedValue(menu);
    });

    it('plans breakfast, lunch and dinner by default and saves under the planned title', async () => {
      await expect(service.generate(data)).resolves.toBe(menu);
      expect(planner.plan).toHaveBeenCalledWith(
        {
          days: 3,
          mealTypes: [MealType.Breakfast, MealType.Lunch, MealType.Dinner],
          startDate: null,
          instructions: null,
        },
        context,
      );
      expect(repository.create).toHaveBeenCalledWith(PROFILE_ID, 'Menu for 3 days', version);
    });

    it('keeps the given title and meal types', async () => {
      await service.generate({ ...data, title: 'Mine', mealTypes: [MealType.Snack] });

      expect(planner.plan).toHaveBeenCalledWith(
        expect.objectContaining({ mealTypes: [MealType.Snack] }),
        context,
      );
      expect(repository.create).toHaveBeenCalledWith(PROFILE_ID, 'Mine', version);
    });
  });

  describe('replaceMeal', () => {
    const data = { versionId: null, dayIndex: 0, position: 0, instructions: 'fish' };

    beforeEach(() => {
      planner.replaceMeal.mockResolvedValue(version);
      repository.addVersion.mockResolvedValue(menu);
    });

    it('starts from the latest version and saves the next one', async () => {
      await expect(service.replaceMeal(MENU_ID, data)).resolves.toBe(menu);
      expect(planner.replaceMeal).toHaveBeenCalledWith(
        [
          {
            dayIndex: 0,
            date: null,
            meals: [{ mealType: MealType.Lunch, servings: 1, recipeId: RECIPE_ID }],
          },
        ],
        { dayIndex: 0, position: 0, instructions: 'fish' },
        context,
      );
      expect(repository.addVersion).toHaveBeenCalledWith(MENU_ID, version);
    });

    it('starts from the given version', async () => {
      await service.replaceMeal(MENU_ID, { ...data, versionId: MENU_VERSION_ID });

      expect(planner.replaceMeal).toHaveBeenCalled();
    });

    it('fails for a version of another menu', async () => {
      await expect(
        service.replaceMeal(MENU_ID, { ...data, versionId: 'other' }),
      ).rejects.toBeInstanceOf(MenuVersionNotFoundException);
    });

    it('fails for a menu without versions', async () => {
      repository.findById.mockResolvedValue(buildMenu());

      await expect(service.replaceMeal(MENU_ID, data)).rejects.toBeInstanceOf(
        MenuVersionNotFoundException,
      );
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

      await expect(service.confirm(MENU_ID, MENU_VERSION_ID)).rejects.toBeInstanceOf(
        MenuViolatesRulesBadRequestException,
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
