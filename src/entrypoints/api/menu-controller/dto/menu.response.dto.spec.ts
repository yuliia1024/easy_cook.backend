import { Prisma } from '../../../../generated/prisma/client';
import { buildMenu, MENU_ID, RECIPE_ID } from '../../../../test/fixtures';
import { MenuResponseDto, MenuSummaryResponseDto } from './menu.response.dto';

describe('menu response DTOs', () => {
  const createdAt = new Date('2026-01-01T00:00:00Z');

  it('maps a summary with the version count', () => {
    const { versions: _versions, ...menu } = buildMenu();

    expect(MenuSummaryResponseDto.from({ ...menu, _count: { versions: 3 } })).toEqual({
      id: MENU_ID,
      title: 'Тиждень 1',
      versionCount: 3,
      createdAt: menu.createdAt,
      updatedAt: menu.updatedAt,
    });
  });

  it('maps versions, days and meals', () => {
    const menu = buildMenu({
      versions: [
        {
          id: 'v1',
          menuId: MENU_ID,
          versionNumber: 1,
          generatedBy: 'llm',
          nutritionGoalsSnapshot: { caloriesKcal: 2000 },
          compositionSnapshot: { days: 1 },
          notes: null,
          createdAt,
          days: [
            {
              id: 'd1',
              menuVersionId: 'v1',
              dayIndex: 0,
              date: null,
              meals: [
                {
                  id: 'm1',
                  menuDayId: 'd1',
                  mealType: 'lunch',
                  position: 0,
                  recipeId: RECIPE_ID,
                  servings: new Prisma.Decimal(1.5),
                  recipeSnapshot: { name: 'Суп' },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(MenuResponseDto.from(menu).versions[0]).toEqual({
      id: 'v1',
      versionNumber: 1,
      generatedBy: 'llm',
      nutritionGoalsSnapshot: { caloriesKcal: 2000 },
      compositionSnapshot: { days: 1 },
      notes: null,
      createdAt,
      days: [
        {
          id: 'd1',
          dayIndex: 0,
          date: null,
          meals: [
            {
              id: 'm1',
              mealType: 'lunch',
              position: 0,
              recipeId: RECIPE_ID,
              servings: 1.5,
              recipeSnapshot: { name: 'Суп' },
            },
          ],
        },
      ],
    });
  });
});
