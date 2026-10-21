import {
  CalculationMode,
  MealType,
  MenuIssueCode,
  MenuIssueSeverity,
} from '../../../common/constants';
import { NutritionGoalSnapshot, PreferenceRules } from '../../../common/types';
import { buildRecipeSnapshot, RECIPE_ID } from '../../../test/fixtures';
import { composeMenu, ResolvedDay } from './menu-composition';
import { dietTagsSatisfying, errorsOf, mentions, recipeIssues, validateMenu } from './menu-rules';

const NO_RULES: PreferenceRules = {
  diets: [],
  allergies: [],
  excludedIngredients: [],
  dislikedFoods: [],
};

describe('menu rules', () => {
  describe('dietTagsSatisfying', () => {
    it.each([
      ['vegan', ['vegan']],
      ['vegetarian', ['vegetarian', 'vegan']],
      ['pescatarian', ['pescatarian', 'vegetarian', 'vegan']],
      ['gluten_free', ['gluten_free']],
      ['paleo', ['paleo']],
    ])('%s ← %j', (diet, tags) => {
      expect(dietTagsSatisfying(diet)).toEqual(tags);
    });
  });

  describe('mentions', () => {
    it.each([
      ['Peanut butter', 'peanut', true],
      ['Peanuts, roasted', 'peanut', true],
      ['Tomatoes, raw', 'tomato', true],
      ['Eggplant, raw', 'egg', false],
      ['Sesame oil', 'sesame oil', true],
      ['Арахіс смажений', 'арахіс', true],
      ['Арахісова паста', 'арахіс', false],
      ['Rice (1+1)', '1+1', true],
    ])('%s / %s → %s', (text, value, expected) => {
      expect(mentions(text, value)).toBe(expected);
    });
  });

  describe('recipeIssues', () => {
    const recipe = buildRecipeSnapshot({
      dietType: ['vegetarian'],
      ingredients: [
        {
          foodItemId: 'f1',
          foodName: 'Rice, boiled',
          foodNameEn: null,
          state: 'boiled',
          quantityG: 200,
          isOptional: false,
        },
        {
          foodItemId: 'f2',
          foodName: 'Арахіс',
          foodNameEn: 'Peanuts',
          state: 'roasted',
          quantityG: 10,
          isOptional: true,
        },
      ],
    });

    it('passes a recipe without rules', () => {
      expect(recipeIssues(recipe, NO_RULES)).toEqual([]);
    });

    it('reports missing diet tags, allergens and excluded foods as errors', () => {
      const issues = recipeIssues(recipe, {
        ...NO_RULES,
        diets: ['vegetarian', 'vegan'],
        allergies: ['peanut'],
        excludedIngredients: ['rice'],
      });

      expect(issues).toEqual([
        {
          severity: MenuIssueSeverity.Error,
          code: MenuIssueCode.DietViolation,
          message: 'Rice with vegetables is not vegan',
        },
        {
          severity: MenuIssueSeverity.Error,
          code: MenuIssueCode.Allergen,
          message: 'Rice with vegetables contains Арахіс (allergy: peanut)',
        },
        {
          severity: MenuIssueSeverity.Error,
          code: MenuIssueCode.ExcludedIngredient,
          message: 'Rice with vegetables contains Rice, boiled (excluded: rice)',
        },
      ]);
    });

    it.each([
      ['vegan', 'vegetarian', true],
      ['vegan', 'pescatarian', true],
      ['vegetarian', 'pescatarian', true],
      ['vegetarian', 'vegan', false],
      ['pescatarian', 'vegetarian', false],
      ['high_protein', 'vegetarian', false],
      ['high_protein', 'pescatarian', false],
    ])('a %s recipe for a %s diet → passes: %s', (tag, diet, passes) => {
      const issues = recipeIssues(buildRecipeSnapshot({ dietType: [tag], ingredients: [] }), {
        ...NO_RULES,
        diets: [diet],
      });

      expect(issues).toEqual(
        passes
          ? []
          : [
              expect.objectContaining({
                code: MenuIssueCode.DietViolation,
                message: expect.stringContaining(`is not ${diet}`),
              }),
            ],
      );
    });

    it('reports disliked foods as warnings', () => {
      expect(recipeIssues(recipe, { ...NO_RULES, dislikedFoods: ['rice'] })).toEqual([
        {
          severity: MenuIssueSeverity.Warning,
          code: MenuIssueCode.DislikedFood,
          message: 'Rice with vegetables contains Rice, boiled, which you dislike',
        },
      ]);
    });
  });

  describe('validateMenu', () => {
    const goal: NutritionGoalSnapshot = {
      goalId: 'g',
      caloriesKcal: 2000,
      proteinG: 100,
      fatG: 60,
      carbsG: 260,
      calculationMode: CalculationMode.Manual,
      ruleVersion: null,
    };
    const day = (dayIndex: number, servings: number, complete = true): ResolvedDay => ({
      dayIndex,
      date: null,
      meals: [
        {
          mealType: MealType.Lunch,
          servings,
          recipeId: RECIPE_ID,
          recipe: buildRecipeSnapshot({
            perServing: { kcal: 1000, proteinG: 50, fatG: 30, carbsG: 130 },
            complete,
          }),
        },
      ],
    });
    const validate = (days: ResolvedDay[], rules = NO_RULES, target = goal) =>
      validateMenu(days, composeMenu(days).days, rules, target);

    it('accepts days within 15 % of the goal', () => {
      expect(validate([day(0, 2), day(1, 1.75)])).toEqual([]);
    });

    it('warns about days away from the goal', () => {
      expect(validate([day(0, 1), day(1, 2.5)])).toEqual([
        {
          severity: MenuIssueSeverity.Warning,
          code: MenuIssueCode.CaloriesOffTarget,
          message: 'Day 1: 1000 kcal is 50 % below the 2000 kcal goal',
          dayIndex: 0,
        },
        {
          severity: MenuIssueSeverity.Warning,
          code: MenuIssueCode.CaloriesOffTarget,
          message: 'Day 2: 2500 kcal is 25 % above the 2000 kcal goal',
          dayIndex: 1,
        },
      ]);
    });

    it('skips the calorie check without a goal', () => {
      expect(validate([day(0, 1)], NO_RULES, null)).toEqual([]);
    });

    it('warns about unknown nutrient values', () => {
      expect(validate([day(0, 2, false)])).toEqual([
        expect.objectContaining({ code: MenuIssueCode.NutritionIncomplete, dayIndex: 0 }),
      ]);
    });

    it('places recipe issues at their meal', () => {
      const issues = validate([day(3, 2)], { ...NO_RULES, diets: ['gluten_free'] });

      expect(issues).toEqual([
        {
          severity: MenuIssueSeverity.Error,
          code: MenuIssueCode.DietViolation,
          message: 'Day 4, lunch: Rice with vegetables is not gluten_free',
          dayIndex: 3,
          position: 0,
          recipeId: RECIPE_ID,
        },
      ]);
      expect(errorsOf(issues)).toHaveLength(1);
    });
  });
});
