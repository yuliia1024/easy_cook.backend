import {
  ChatResponseType,
  MealType,
  MENU_PLAN_INSTRUCTIONS,
  MENU_PLAN_MAX_OUTPUT_TOKENS,
  NO_MENU_RECIPES_REPLY,
  PreferenceType,
} from '../../../common/constants';
import { MenuPlan, MenuPlanSchema } from '../../../common/contracts';
import { AssistantInvalidOutputException } from '../../../common/exceptions';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { createMock } from '../../../test/create-mock';
import { buildPreference, buildRecipe } from '../../../test/fixtures';
import { DietaryPreferenceService } from '../dietary-preference/dietary-preference.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { RecipeService } from '../recipe/recipe.service';
import { MenuPlannerService } from './menu-planner.service';

describe('MenuPlannerService', () => {
  let dietaryPreferenceService: jest.Mocked<DietaryPreferenceService>;
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

  beforeEach(() => {
    dietaryPreferenceService = createMock<DietaryPreferenceService>();
    dietaryPreferenceService.getAll.mockResolvedValue([
      buildPreference({ preferenceType: PreferenceType.Diet, value: 'vegan' }),
    ]);
    recipeService = createMock<RecipeService>();
    recipeService.getAllowed.mockResolvedValue([breakfast, lunch, dinner]);
    openAiService = createMock<OpenAiService>();
    openAiService.generateStructured.mockResolvedValue(plan);
    service = new MenuPlannerService(
      dietaryPreferenceService,
      recipeService,
      new NutritionService(),
      openAiService,
    );
  });

  it('sends the model only the request and the recipes the preferences allow', async () => {
    const abort = new AbortController();

    await service.plan('Light day', abort.signal);

    expect(recipeService.getAllowed).toHaveBeenCalledWith({
      diets: ['vegan'],
      allergies: [],
      excludedIngredients: [],
      dislikedFoods: [],
    });
    expect(openAiService.generateStructured).toHaveBeenCalledWith(
      [
        {
          role: 'user',
          content: JSON.stringify({
            request: 'Light day',
            recipes: {
              breakfast: [{ id: 'b', name: 'Rice porridge' }],
              lunch: [{ id: 'l', name: 'Rice bowl' }],
              dinner: [{ id: 'd', name: 'Rice salad' }],
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

  it('composes the chosen recipes into a one-day menu, one serving each', async () => {
    await expect(service.plan('Light day')).resolves.toMatchObject({
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

  it('answers without the model when a meal has no allowed recipe', async () => {
    recipeService.getAllowed.mockResolvedValue([
      breakfast,
      buildRecipe({ id: 'b2', mealType: MealType.Breakfast }),
      dinner,
    ]);

    await expect(service.plan('Light day')).resolves.toEqual({
      type: ChatResponseType.Text,
      message: NO_MENU_RECIPES_REPLY,
    });
    expect(openAiService.generateStructured).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown recipe', { lunch: 'x' }],
    ['a recipe of another meal', { lunch: 'b' }],
  ])('rejects %s as invalid output', async (_case, choice) => {
    openAiService.generateStructured.mockResolvedValue({ ...plan, ...choice });

    await expect(service.plan('Light day')).rejects.toBeInstanceOf(AssistantInvalidOutputException);
  });
});
