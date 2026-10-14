import { CalculationMode, MealType, MenuGeneratedBy } from '../../../../common/constants';
import {
  buildMenu,
  buildMenuVersion,
  buildRecipeSnapshot,
  MENU_ID,
  MENU_VERSION_ID,
  RECIPE_ID,
} from '../../../../test/fixtures';
import { MenuResponseDto, MenuSummaryResponseDto } from './menu.response.dto';

describe('menu response DTOs', () => {
  it('maps a summary with the version count and the confirmation', () => {
    const { versions: _versions, ...menu } = buildMenu({ confirmedVersionId: MENU_VERSION_ID });

    expect(MenuSummaryResponseDto.from({ ...menu, _count: { versions: 3 } })).toEqual({
      id: MENU_ID,
      title: 'Week 1',
      versionCount: 3,
      confirmedVersionId: MENU_VERSION_ID,
      confirmedAt: null,
      createdAt: menu.createdAt,
      updatedAt: menu.updatedAt,
    });
  });

  it('maps versions with the stored nutrition and issues', () => {
    const goal = {
      goalId: 'g',
      caloriesKcal: 2000,
      proteinG: 100,
      fatG: 60,
      carbsG: 260,
      calculationMode: CalculationMode.Manual,
      ruleVersion: null,
    };
    const version = buildMenuVersion({
      generatedBy: MenuGeneratedBy.Stub,
      nutritionGoalsSnapshot: goal,
    });
    version.days[0].date = new Date('2026-10-20T00:00:00Z');
    const menu = buildMenu({ confirmedVersionId: MENU_VERSION_ID, versions: [version] });

    expect(MenuResponseDto.from(menu)).toEqual({
      id: MENU_ID,
      title: 'Week 1',
      confirmedVersionId: MENU_VERSION_ID,
      confirmedAt: null,
      createdAt: menu.createdAt,
      updatedAt: menu.updatedAt,
      versions: [
        {
          id: MENU_VERSION_ID,
          versionNumber: 1,
          generatedBy: MenuGeneratedBy.Stub,
          notes: null,
          createdAt: version.createdAt,
          isConfirmed: true,
          nutritionGoal: goal,
          dailyAverage: { kcal: 130, proteinG: 2.7, fatG: 0.3, carbsG: 28.2 },
          issues: [],
          days: [
            {
              id: version.days[0].id,
              dayIndex: 0,
              date: '2026-10-20',
              totals: { kcal: 130, proteinG: 2.7, fatG: 0.3, carbsG: 28.2 },
              complete: true,
              meals: [
                {
                  id: version.days[0].meals[0].id,
                  mealType: MealType.Lunch,
                  position: 0,
                  recipeId: RECIPE_ID,
                  servings: 1,
                  nutrition: { kcal: 130, proteinG: 2.7, fatG: 0.3, carbsG: 28.2 },
                  complete: true,
                  recipe: buildRecipeSnapshot(),
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('marks other versions as not confirmed', () => {
    const menu = buildMenu({ versions: [buildMenuVersion()] });

    expect(MenuResponseDto.from(menu).versions[0]).toMatchObject({
      isConfirmed: false,
      nutritionGoal: null,
    });
  });
});
