import {
  CalculationMode,
  Goal,
  MealType,
  MenuIssueCode,
  MenuIssueSeverity,
} from '../../../common/constants';
import { ProfileContext, ResolvedDay } from '../../../common/types';
import { buildMenuVersion, buildRecipeSnapshot, PROFILE_ID } from '../../../test/fixtures';
import { MenuComposer } from './menu-composer';

describe('MenuComposer', () => {
  it('revalidates a saved version against the current rules', () => {
    const issues = new MenuComposer().revalidate(buildMenuVersion(), {
      profileId: PROFILE_ID,
      goal: Goal.Maintain,
      nutritionGoal: null,
      rules: { diets: ['gluten_free'], allergies: [], excludedIngredients: [], dislikedFoods: [] },
    });

    expect(issues).toEqual([
      expect.objectContaining({
        code: MenuIssueCode.DietViolation,
        message: 'Day 1, lunch: Rice with vegetables is not gluten_free',
      }),
    ]);
  });

  describe('compose', () => {
    const days: ResolvedDay[] = [
      {
        dayIndex: 0,
        date: null,
        meals: [
          {
            mealType: MealType.Lunch,
            servings: 2,
            recipeId: 'r',
            recipe: buildRecipeSnapshot(),
          },
        ],
      },
    ];
    const context: ProfileContext = {
      profileId: PROFILE_ID,
      goal: Goal.Maintain,
      nutritionGoal: null,
      rules: { diets: [], allergies: [], excludedIngredients: [], dislikedFoods: [] },
    };

    it('composes the nutrition of a menu without issues when there is no goal', () => {
      expect(new MenuComposer().compose(days, context)).toEqual({
        days: [expect.objectContaining({ totals: expect.objectContaining({ kcal: 260 }) })],
        dailyAverage: expect.objectContaining({ kcal: 260 }),
        issues: [],
      });
    });

    it('warns when a day is off the calorie goal', () => {
      const { issues } = new MenuComposer().compose(days, {
        ...context,
        nutritionGoal: {
          goalId: 'g',
          caloriesKcal: 2000,
          proteinG: 104,
          fatG: 56,
          carbsG: 270,
          calculationMode: CalculationMode.Manual,
          ruleVersion: null,
        },
      });

      expect(issues).toEqual([
        {
          severity: MenuIssueSeverity.Warning,
          code: MenuIssueCode.CaloriesOffTarget,
          message: 'Day 1: 260 kcal is 87 % below the 2000 kcal goal',
          dayIndex: 0,
        },
      ]);
    });
  });
});
