import {
  ChatResponseType,
  Goal,
  CalculationMode,
  MealType,
  MenuIssueCode,
  MenuIssueSeverity,
  MENU_PLAN_INSTRUCTIONS,
  MENU_PLAN_MAX_OUTPUT_TOKENS,
  NO_MENU_RECIPES_REPLY,
  NO_PROFILE_REPLY,
} from '../../../common/constants';
import { MenuPlan, MenuPlanSchema } from '../../../common/contracts';
import { AssistantInvalidOutputException } from '../../../common/exceptions';
import { ProfileContext } from '../../../common/types';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { createMock } from '../../../test/create-mock';
import { buildFoodItem, buildIngredient, buildRecipe, PROFILE_ID } from '../../../test/fixtures';
import { NutritionService } from '../nutrition/nutrition.service';
import { toModelProfile } from '../profile-context/model-profile';
import { RecipeService } from '../recipe/recipe.service';
import { MenuComposer } from './menu-composer';
import { MenuPlannerService } from './menu-planner.service';

describe('MenuPlannerService', () => {
  let recipeService: jest.Mocked<RecipeService>;
  let openAiService: jest.Mocked<OpenAiService>;
  let service: MenuPlannerService;
  /** 130 kcal per serving each (200 g boiled rice, 2 servings). */
  const breakfast = buildRecipe({ id: 'b', name: 'Rice porridge', mealType: MealType.Breakfast });
  const lunch = buildRecipe({ id: 'l', name: 'Rice bowl', mealType: MealType.Lunch });
  const dinner = buildRecipe({ id: 'd', name: 'Rice salad', mealType: MealType.Dinner });
  const plan: MenuPlan = {
    message: 'Here is your day.',
    breakfast: 'b',
    lunch: 'l',
    dinner: 'd',
  };
  const profile: ProfileContext = {
    profileId: PROFILE_ID,
    goal: Goal.LoseWeight,
    nutritionGoal: null,
    rules: { diets: ['vegan'], allergies: [], excludedIngredients: [], dislikedFoods: [] },
  };

  beforeEach(() => {
    recipeService = createMock<RecipeService>();
    recipeService.getAllowed.mockResolvedValue([breakfast, lunch, dinner]);
    openAiService = createMock<OpenAiService>();
    openAiService.generateStructured.mockResolvedValue(plan);
    service = new MenuPlannerService(
      recipeService,
      new NutritionService(),
      openAiService,
      new MenuComposer(),
    );
  });

  it('sends the model the request, the profile and the allowed recipes with their nutrition', async () => {
    const abort = new AbortController();
    const perServing = { kcal: 130, proteinG: 3, fatG: 0, carbsG: 28 };

    await service.plan('Light day', profile, abort.signal);

    expect(recipeService.getAllowed).toHaveBeenCalledWith(profile.rules);
    expect(openAiService.generateStructured).toHaveBeenCalledWith(
      [
        {
          role: 'user',
          content: JSON.stringify({
            request: 'Light day',
            profile: toModelProfile(profile),
            recipes: {
              breakfast: [{ id: 'b', name: 'Rice porridge', perServing, complete: true }],
              lunch: [{ id: 'l', name: 'Rice bowl', perServing, complete: true }],
              dinner: [{ id: 'd', name: 'Rice salad', perServing, complete: true }],
            },
          }),
        },
      ],
      MenuPlanSchema,
      {
        instructions: MENU_PLAN_INSTRUCTIONS,
        maxOutputTokens: MENU_PLAN_MAX_OUTPUT_TOKENS,
        abortSignal: abort.signal,
      },
    );
  });

  it('composes the chosen recipes into a one-day menu, one serving each, without issues when there is no goal', async () => {
    await expect(service.plan('Light day', profile)).resolves.toMatchObject({
      type: ChatResponseType.MenuReady,
      message: 'Here is your day.',
      menu: {
        days: [
          {
            dayIndex: 0,
            date: null,
            meals: [
              { position: 0, mealType: MealType.Breakfast, recipeId: 'b', servings: 1 },
              { position: 1, mealType: MealType.Lunch, recipeId: 'l', servings: 1 },
              { position: 2, mealType: MealType.Dinner, recipeId: 'd', servings: 1 },
            ],
            totals: { kcal: 390 },
          },
        ],
        issues: [],
      },
    });
  });

  it('tells the model a recipe with unknown values is incomplete', async () => {
    const unknownFat = buildRecipe({
      id: 'l',
      name: 'Rice bowl',
      ingredients: [buildIngredient({ foodItem: buildFoodItem({ fatG: null }) })],
    });
    recipeService.getAllowed.mockResolvedValue([breakfast, unknownFat, dinner]);

    await service.plan('Light day', profile);

    const [[[message]]] = openAiService.generateStructured.mock.calls as unknown as Array<
      [Array<{ content: string }>]
    >;
    expect(JSON.parse(message.content).recipes.lunch).toEqual([
      expect.objectContaining({ id: 'l', complete: false }),
    ]);
  });

  it('warns when the day is off the calorie goal', async () => {
    const withGoal: ProfileContext = {
      ...profile,
      nutritionGoal: {
        goalId: 'g',
        caloriesKcal: 2000,
        proteinG: 104,
        fatG: 56,
        carbsG: 270,
        calculationMode: CalculationMode.Manual,
        ruleVersion: null,
      },
    };

    const response = await service.plan('Light day', withGoal);

    expect(response).toMatchObject({
      menu: {
        issues: [
          {
            severity: MenuIssueSeverity.Warning,
            code: MenuIssueCode.CaloriesOffTarget,
            message: 'Day 1: 390 kcal is 81 % below the 2000 kcal goal',
            dayIndex: 0,
          },
        ],
      },
    });
  });

  it('reports the issues of the chosen recipes against the preferences', async () => {
    const response = await service.plan('Light day', {
      ...profile,
      rules: { ...profile.rules, dislikedFoods: ['rice'] },
    });

    expect(response).toMatchObject({
      menu: {
        issues: [
          expect.objectContaining({ code: MenuIssueCode.DislikedFood, position: 0 }),
          expect.objectContaining({ code: MenuIssueCode.DislikedFood, position: 1 }),
          expect.objectContaining({ code: MenuIssueCode.DislikedFood, position: 2 }),
        ],
      },
    });
  });

  it('reports a broken hard rule as an error, should the allowed recipes let one through', async () => {
    recipeService.getAllowed.mockResolvedValue([
      breakfast,
      buildRecipe({ id: 'l', name: 'Rice bowl', dietType: [] }),
      dinner,
    ]);

    const response = await service.plan('Light day', profile);

    expect(response).toMatchObject({
      menu: {
        issues: [
          {
            severity: MenuIssueSeverity.Error,
            code: MenuIssueCode.DietViolation,
            message: 'Day 1, lunch: Rice bowl is not vegan',
            dayIndex: 0,
            position: 1,
            recipeId: 'l',
          },
        ],
      },
    });
  });

  it('answers without the model when a meal has no allowed recipe', async () => {
    recipeService.getAllowed.mockResolvedValue([
      breakfast,
      buildRecipe({ id: 'b2', mealType: MealType.Breakfast }),
      dinner,
    ]);

    await expect(service.plan('Light day', profile)).resolves.toEqual({
      type: ChatResponseType.Text,
      message: NO_MENU_RECIPES_REPLY,
    });
    expect(openAiService.generateStructured).not.toHaveBeenCalled();
  });

  it('asks to fill in the profile first, without recipes or the model', async () => {
    await expect(service.plan('Light day', null)).resolves.toEqual({
      type: ChatResponseType.Text,
      message: NO_PROFILE_REPLY,
    });
    expect(recipeService.getAllowed).not.toHaveBeenCalled();
    expect(openAiService.generateStructured).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown recipe', { lunch: 'x' }],
    ['a recipe of another meal', { lunch: 'b' }],
  ])('rejects %s as invalid output', async (_case, choice) => {
    openAiService.generateStructured.mockResolvedValue({ ...plan, ...choice });

    await expect(service.plan('Light day', profile)).rejects.toBeInstanceOf(
      AssistantInvalidOutputException,
    );
  });
});
