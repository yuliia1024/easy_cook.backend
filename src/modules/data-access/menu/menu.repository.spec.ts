import { Prisma } from '../../../generated/prisma/client';
import { MealType, MenuGeneratedBy, SortOrder } from '../../../common/constants';
import { buildMenu, MENU_ID, PROFILE_ID, RECIPE_ID } from '../../../test/fixtures';
import { createPrismaMock, PrismaMock } from '../../../test/prisma-mock';
import { MENU_INCLUDE, MenuRepository, MenuVersionData } from './menu.repository';

describe('MenuRepository', () => {
  let prisma: PrismaMock;
  let repository: MenuRepository;
  const VERSION_ID = '99999999-9999-4999-8999-999999999999';
  const version: MenuVersionData = {
    generatedBy: MenuGeneratedBy.Manual,
    notes: null,
    nutritionGoalsSnapshot: Prisma.JsonNull,
    compositionSnapshot: { days: [] },
    days: [
      {
        dayIndex: 0,
        date: null,
        meals: [
          { mealType: MealType.Lunch, recipeId: RECIPE_ID, servings: 1, recipeSnapshot: {} },
          { mealType: MealType.Dinner, recipeId: null, servings: 2, recipeSnapshot: {} },
        ],
      },
    ],
  };
  /** What `version` becomes as a nested Prisma create. */
  const versionInput = (versionNumber: number): object => ({
    generatedBy: MenuGeneratedBy.Manual,
    notes: null,
    nutritionGoalsSnapshot: Prisma.JsonNull,
    compositionSnapshot: { days: [] },
    versionNumber,
    days: {
      create: [
        {
          dayIndex: 0,
          date: null,
          meals: {
            create: [
              {
                mealType: MealType.Lunch,
                servings: 1,
                recipeSnapshot: {},
                position: 0,
                recipe: { connect: { id: RECIPE_ID } },
              },
              { mealType: MealType.Dinner, servings: 2, recipeSnapshot: {}, position: 1 },
            ],
          },
        },
      ],
    },
  });

  beforeEach(() => {
    prisma = createPrismaMock();
    repository = new MenuRepository(prisma);
  });

  it('lists the profile menus newest first with their version count', async () => {
    await repository.findAll(PROFILE_ID);

    expect(prisma.menu.findMany).toHaveBeenCalledWith({
      where: { profileId: PROFILE_ID },
      include: { _count: { select: { versions: true } } },
      orderBy: { createdAt: SortOrder.Desc },
    });
  });

  it('loads one menu with versions, days and meals', async () => {
    await repository.findById(PROFILE_ID, MENU_ID);

    expect(prisma.menu.findFirst).toHaveBeenCalledWith({
      where: { id: MENU_ID, profileId: PROFILE_ID },
      include: MENU_INCLUDE,
    });
  });

  it('creates a menu with version 1, positions in order, deleted recipes unlinked', async () => {
    prisma.menu.create.mockResolvedValue(buildMenu());

    await repository.create(PROFILE_ID, 'Week', version);

    expect(prisma.menu.create).toHaveBeenCalledWith({
      data: { profileId: PROFILE_ID, title: 'Week', versions: { create: versionInput(1) } },
      include: MENU_INCLUDE,
    });
  });

  it('appends the next version number in a transaction', async () => {
    prisma.menuVersion.aggregate.mockResolvedValue({ _max: { versionNumber: 3 } } as never);

    await repository.addVersion(MENU_ID, version);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.menuVersion.aggregate).toHaveBeenCalledWith({
      where: { menuId: MENU_ID },
      _max: { versionNumber: true },
    });
    expect(prisma.menu.update).toHaveBeenCalledWith({
      where: { id: MENU_ID },
      data: { versions: { create: versionInput(4) } },
      include: MENU_INCLUDE,
    });
  });

  it('starts at version 1 when the menu has none', async () => {
    prisma.menuVersion.aggregate.mockResolvedValue({ _max: { versionNumber: null } } as never);

    await repository.addVersion(MENU_ID, version);

    expect(prisma.menu.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { versions: { create: versionInput(1) } } }),
    );
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
