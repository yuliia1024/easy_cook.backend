import {
  CalculationMode,
  MealType,
  MenuGeneratedBy,
  MenuIssueCode,
  MenuIssueSeverity,
} from '../../../common/constants';
import { NoRecipeCandidatesException } from '../../../common/exceptions';
import { NutritionGoalSnapshot, PreferenceRules } from '../../../common/types';
import { MenuPlanRequest, RecipeCandidate } from './assistant';
import { StubAssistant } from './stub-assistant';

const goal: NutritionGoalSnapshot = {
  goalId: 'g',
  caloriesKcal: 2000,
  proteinG: 100,
  fatG: 60,
  carbsG: 260,
  calculationMode: CalculationMode.RuleBased,
  ruleVersion: 'v2',
};
const rules: PreferenceRules = {
  diets: [],
  allergies: [],
  excludedIngredients: [],
  dislikedFoods: [],
};

const candidate = (id: string, mealType: MealType, kcal: number): RecipeCandidate => ({
  id,
  name: id,
  mealType,
  dietType: [],
  perServing: { kcal, proteinG: 0, fatG: 0, carbsG: 0 },
  complete: true,
});

describe('StubAssistant', () => {
  const assistant = new StubAssistant();
  const candidates = [
    candidate('oats', MealType.Breakfast, 400),
    candidate('eggs', MealType.Breakfast, 250),
    candidate('soup', MealType.Lunch, 350),
    candidate('bowl', MealType.Lunch, 700),
    candidate('fish', MealType.Dinner, 600),
    candidate('salad', MealType.Dinner, 0),
  ];
  const request = (overrides: Partial<MenuPlanRequest> = {}): MenuPlanRequest => ({
    days: [
      { dayIndex: 0, date: null },
      { dayIndex: 1, date: new Date('2026-10-21T00:00:00Z') },
    ],
    mealTypes: [MealType.Breakfast, MealType.Lunch, MealType.Dinner],
    goal,
    rules,
    candidates,
    feedback: [],
    instructions: null,
    ...overrides,
  });

  it('marks its menus as stub plans', () => {
    expect(assistant.generatedBy).toBe(MenuGeneratedBy.Stub);
  });

  describe('planMenu', () => {
    it('fills every day with the closest recipes in whole or half portions', async () => {
      const plan = await assistant.planMenu(request());

      expect(plan.title).toBe('Menu for 2 days');
      // Targets: breakfast 2000 × 0.25/0.9 ≈ 556, lunch ≈ 778, dinner ≈ 667 kcal.
      expect(plan.days[0]).toEqual({
        dayIndex: 0,
        date: null,
        meals: [
          { mealType: MealType.Breakfast, recipeId: 'oats', servings: 1.5 },
          { mealType: MealType.Lunch, recipeId: 'soup', servings: 2 },
          { mealType: MealType.Dinner, recipeId: 'fish', servings: 1 },
        ],
      });
    });

    it('rotates recipes across days unless the alternative misses the target by far', async () => {
      const plan = await assistant.planMenu(request());

      expect(plan.days[1].date).toEqual(new Date('2026-10-21T00:00:00Z'));
      // The 0 kcal salad misses dinner by 100 %, more than the repeat penalty of the fish.
      expect(plan.days[1].meals.map((meal) => meal.recipeId)).toEqual(['eggs', 'bowl', 'fish']);
    });

    it('avoids recipes rejected by the previous attempt', async () => {
      const plan = await assistant.planMenu(
        request({
          days: [{ dayIndex: 0, date: null }],
          feedback: [
            {
              severity: MenuIssueSeverity.Error,
              code: MenuIssueCode.Allergen,
              message: 'contains peanut',
              recipeId: 'oats',
            },
            {
              severity: MenuIssueSeverity.Warning,
              code: MenuIssueCode.DislikedFood,
              message: 'disliked',
              recipeId: 'soup',
            },
          ],
        }),
      );

      expect(plan.days[0].meals.map((meal) => meal.recipeId)).toEqual(['eggs', 'soup', 'fish']);
    });

    it('fails when a meal type has no candidate', async () => {
      await expect(
        assistant.planMenu(request({ mealTypes: [MealType.Snack] })),
      ).rejects.toBeInstanceOf(NoRecipeCandidatesException);
    });
  });

  describe('replaceMeal', () => {
    const day = {
      dayIndex: 0,
      date: null,
      meals: [
        { mealType: MealType.Lunch, recipeId: 'soup', servings: 2 },
        { mealType: MealType.Dinner, recipeId: 'fish', servings: 1 },
      ],
    };

    it('picks another recipe sized to the meal share of the goal', async () => {
      const proposal = await assistant.replaceMeal({
        day,
        position: 0,
        goal,
        rules,
        candidates,
        feedback: [],
        instructions: null,
      });

      // Lunch is 0.35 / 0.65 of 2000 kcal ≈ 1077 kcal.
      expect(proposal).toEqual({
        recipeId: 'bowl',
        servings: 1.5,
        notes: 'Replaced by the stub planner with bowl.',
      });
    });

    it('keeps the servings without a goal', async () => {
      const proposal = await assistant.replaceMeal({
        day,
        position: 1,
        goal: null,
        rules,
        candidates,
        feedback: [],
        instructions: null,
      });

      expect(proposal).toMatchObject({ recipeId: 'salad', servings: 1 });
    });

    it('fails when there is no other recipe', async () => {
      await expect(
        assistant.replaceMeal({
          day,
          position: 0,
          goal,
          rules,
          candidates: [candidate('soup', MealType.Lunch, 350)],
          feedback: [],
          instructions: null,
        }),
      ).rejects.toBeInstanceOf(NoRecipeCandidatesException);
    });
  });
});
