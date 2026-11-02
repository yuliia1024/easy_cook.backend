import { MealType, MenuGeneratedBy, MenuStatus, SortOrder } from '../../../common/constants';
import { MenuComposition, NutritionGoalSnapshot } from '../../../common/types';
import { Prisma } from '../../../generated/prisma/client';
import { buildRecipeSnapshot, CONVERSATION_ID, MENU_ID, PROFILE_ID } from '../../../test/fixtures';
import { createPrismaMock, PrismaMock } from '../../../test/prisma-mock';
import { MENU_INCLUDE, MenuRepository, MenuVersionData } from './menu.repository';

describe('MenuRepository', () => {
  let prisma: PrismaMock;
  let repository: MenuRepository;
  const VERSION_ID = '99999999-9999-4999-8999-999999999999';

  beforeEach(() => {
    prisma = createPrismaMock();
    repository = new MenuRepository(prisma);
  });

  it('lists the profile menus newest first with their version count', async () => {
    await repository.findAll(PROFILE_ID, MenuStatus.All);

    expect(prisma.menu.findMany).toHaveBeenCalledWith({
      where: { profileId: PROFILE_ID },
      include: { _count: { select: { versions: true } } },
      orderBy: { createdAt: SortOrder.Desc },
    });
  });

  it.each([
    [MenuStatus.Confirmed, { confirmedVersionId: { not: null } }],
    [MenuStatus.Draft, { confirmedVersionId: null }],
  ])('lists the %s menus', async (status, where) => {
    await repository.findAll(PROFILE_ID, status);

    expect(prisma.menu.findMany.mock.calls[0][0].where).toEqual({
      profileId: PROFILE_ID,
      ...where,
    });
  });

  describe('saving versions', () => {
    const recipe = buildRecipeSnapshot();
    const goal = { goalId: 'g', caloriesKcal: 2000 } as NutritionGoalSnapshot;
    const composition = { days: [], dailyAverage: {}, issues: [] } as unknown as MenuComposition;
    const version: MenuVersionData = {
      generatedBy: MenuGeneratedBy.Llm,
      nutritionGoal: goal,
      composition,
      days: [
        {
          dayIndex: 0,
          date: null,
          meals: [
            { mealType: MealType.Breakfast, servings: 1, recipeId: 'b', recipe },
            { mealType: MealType.Lunch, servings: 1.5, recipeId: null, recipe },
          ],
        },
      ],
    };
    const created = {
      generatedBy: MenuGeneratedBy.Llm,
      notes: null,
      nutritionGoalsSnapshot: goal,
      compositionSnapshot: composition,
      days: {
        create: [
          {
            dayIndex: 0,
            date: null,
            meals: {
              create: [
                {
                  position: 0,
                  mealType: MealType.Breakfast,
                  servings: 1,
                  recipeId: 'b',
                  recipeSnapshot: recipe,
                },
                {
                  position: 1,
                  mealType: MealType.Lunch,
                  servings: 1.5,
                  recipeId: null,
                  recipeSnapshot: recipe,
                },
              ],
            },
          },
        ],
      },
    };

    it('creates a draft menu with version 1 and links the conversation, in a transaction', async () => {
      prisma.menu.create.mockResolvedValue({ id: MENU_ID });
      prisma.menuVersion.create.mockResolvedValue({ id: 'v1' });

      await expect(
        repository.createDraft(PROFILE_ID, '1-day menu', version, CONVERSATION_ID),
      ).resolves.toEqual({ id: 'v1' });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.menu.create).toHaveBeenCalledWith({
        data: { profileId: PROFILE_ID, title: '1-day menu' },
      });
      expect(prisma.menuVersion.create).toHaveBeenCalledWith({
        data: { menuId: MENU_ID, versionNumber: 1, ...created },
      });
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: CONVERSATION_ID },
        data: { menuId: MENU_ID },
      });
    });

    it('adds the version after the latest one and touches the menu, in a transaction', async () => {
      prisma.menuVersion.aggregate.mockResolvedValue({ _max: { versionNumber: 2 } });
      prisma.menuVersion.create.mockResolvedValue({ id: 'v3' });

      await expect(
        repository.addVersion(MENU_ID, { ...version, nutritionGoal: null, notes: 'n' }),
      ).resolves.toEqual({ id: 'v3' });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.menuVersion.aggregate).toHaveBeenCalledWith({
        where: { menuId: MENU_ID },
        _max: { versionNumber: true },
      });
      expect(prisma.menuVersion.create).toHaveBeenCalledWith({
        data: {
          menuId: MENU_ID,
          versionNumber: 3,
          ...created,
          notes: 'n',
          nutritionGoalsSnapshot: Prisma.JsonNull,
        },
      });
      expect(prisma.menu.update).toHaveBeenCalledWith({
        where: { id: MENU_ID },
        data: { updatedAt: expect.any(Date) },
      });
    });

    it('numbers the first version of a menu without versions 1', async () => {
      prisma.menuVersion.aggregate.mockResolvedValue({ _max: { versionNumber: null } });

      await repository.addVersion(MENU_ID, version);

      expect(prisma.menuVersion.create.mock.calls[0][0].data.versionNumber).toBe(1);
    });
  });

  it('loads one menu with versions, days and meals', async () => {
    await repository.findById(PROFILE_ID, MENU_ID);

    expect(prisma.menu.findFirst).toHaveBeenCalledWith({
      where: { id: MENU_ID, profileId: PROFILE_ID },
      include: MENU_INCLUDE,
    });
  });

  it('loads one version of a menu of the profile with its days and meals', async () => {
    await repository.findVersion(PROFILE_ID, VERSION_ID);

    expect(prisma.menuVersion.findFirst).toHaveBeenCalledWith({
      where: { id: VERSION_ID, menu: { profileId: PROFILE_ID } },
      include: MENU_INCLUDE.versions.include,
    });
  });

  it('confirms a version with the time', async () => {
    await repository.confirm(MENU_ID, VERSION_ID);

    expect(prisma.menu.update).toHaveBeenCalledWith({
      where: { id: MENU_ID },
      data: { confirmedVersionId: VERSION_ID, confirmedAt: expect.any(Date) },
      include: MENU_INCLUDE,
    });
  });

  it('renames and deletes', async () => {
    await repository.rename(MENU_ID, 'New');
    await repository.delete(MENU_ID);

    expect(prisma.menu.update).toHaveBeenCalledWith({
      where: { id: MENU_ID },
      data: { title: 'New' },
      include: MENU_INCLUDE,
    });
    expect(prisma.menu.delete).toHaveBeenCalledWith({ where: { id: MENU_ID } });
  });
});
