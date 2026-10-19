import { Injectable } from '@nestjs/common';
import {
  MENU_PLAN_INSTRUCTIONS,
  MENU_PLAN_MAX_OUTPUT_TOKENS,
  MENU_PLAN_MEAL_TYPES,
  NO_MENU_RECIPES_REPLY,
} from '../../../common/constants';
import { ChatResponse, MenuPlanSchema } from '../../../common/contracts';
import { AssistantInvalidOutputException } from '../../../common/exceptions';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { DietaryPreferenceService } from '../dietary-preference/dietary-preference.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { RecipeService } from '../recipe/recipe.service';
import { composeMenu, ResolvedDay, snapshotRecipe } from './menu-composition';
import { toPreferenceRules } from './menu-rules';

/**
 * Plans a one-day menu from a chat request: the model picks a breakfast, a lunch and a dinner
 * among the recipes the dietary preferences allow, one serving each. A recipe that is not one of
 * them is invalid output. Nothing is saved.
 */
@Injectable()
export class MenuPlannerService {
  constructor(
    private readonly dietaryPreferenceService: DietaryPreferenceService,
    private readonly recipeService: RecipeService,
    private readonly nutritionService: NutritionService,
    private readonly openAiService: OpenAiService,
  ) {}

  public async plan(message: string, abortSignal?: AbortSignal): Promise<ChatResponse> {
    const rules = toPreferenceRules(await this.dietaryPreferenceService.getAll());
    const recipes = await this.recipeService.getAllowed(rules);
    const options = MENU_PLAN_MEAL_TYPES.map((type) => recipes.filter((r) => r.mealType === type));
    if (options.some((recipesOfMeal) => recipesOfMeal.length === 0)) {
      return { type: 'text', message: NO_MENU_RECIPES_REPLY };
    }

    const plan = await this.openAiService.generateStructured(
      [
        {
          role: 'user',
          content: JSON.stringify({
            request: message,
            recipes: Object.fromEntries(
              MENU_PLAN_MEAL_TYPES.map((type, i) => [
                type,
                options[i].map(({ id, name }) => ({ id, name })),
              ]),
            ),
          }),
        },
      ],
      MenuPlanSchema,
      {
        instructions: MENU_PLAN_INSTRUCTIONS,
        maxOutputTokens: MENU_PLAN_MAX_OUTPUT_TOKENS,
        abortSignal,
      },
    );

    const day: ResolvedDay = {
      dayIndex: 0,
      date: null,
      meals: MENU_PLAN_MEAL_TYPES.map((mealType, i) => {
        const recipe = options[i].find((r) => r.id === plan[mealType]);
        if (!recipe) {
          throw new AssistantInvalidOutputException();
        }
        return {
          mealType,
          servings: 1,
          recipeId: recipe.id,
          recipe: snapshotRecipe(recipe, this.nutritionService.calculateRecipe(recipe)),
        };
      }),
    };
    return {
      type: 'menu_ready',
      message: plan.message,
      menu: { ...composeMenu([day]), issues: [] },
    };
  }
}
