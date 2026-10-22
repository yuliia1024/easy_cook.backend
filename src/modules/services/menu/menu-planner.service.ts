import { Injectable } from '@nestjs/common';
import {
  ChatResponseType,
  MENU_PLAN_INSTRUCTIONS,
  MENU_PLAN_MAX_OUTPUT_TOKENS,
  MENU_PLAN_MEAL_TYPES,
  NO_MENU_RECIPES_REPLY,
  NO_PROFILE_REPLY,
} from '../../../common/constants';
import { MenuPlanSchema } from '../../../common/contracts';
import { ChatResponse, MacroValues, ProfileContext } from '../../../common/types';
import { AssistantInvalidOutputException } from '../../../common/exceptions';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { RecipeWithIngredients } from '../../data-access/recipe/recipe.repository';
import { NutritionService, RecipeNutrition } from '../nutrition/nutrition.service';
import { toModelProfile } from '../profile-context/model-profile';
import { RecipeService } from '../recipe/recipe.service';
import { MenuComposer } from './menu-composer';
import { ResolvedDay, snapshotRecipe } from './menu-composition';

interface RecipeOption {
  recipe: RecipeWithIngredients;
  nutrition: RecipeNutrition;
}

const roundToUnits = ({ kcal, proteinG, fatG, carbsG }: MacroValues): MacroValues => ({
  kcal: Math.round(kcal),
  proteinG: Math.round(proteinG),
  fatG: Math.round(fatG),
  carbsG: Math.round(carbsG),
});

/**
 * Plans a one-day menu from a chat request: the model picks a breakfast, a lunch and a dinner
 * among the recipes the dietary preferences allow, one serving each, knowing the profile goal, the
 * daily target and the calories and macros of a serving. A recipe that is not one of them is
 * invalid output. The menu comes with its issues against the profile. Nothing is saved.
 * Without a profile there are no rules to follow, so it asks to fill one in instead.
 */
@Injectable()
export class MenuPlannerService {
  constructor(
    private readonly recipeService: RecipeService,
    private readonly nutritionService: NutritionService,
    private readonly openAiService: OpenAiService,
    private readonly menuComposer: MenuComposer,
  ) {}

  public async plan(
    message: string,
    profile: ProfileContext | null,
    abortSignal?: AbortSignal,
  ): Promise<ChatResponse> {
    if (!profile) {
      return { type: ChatResponseType.Text, message: NO_PROFILE_REPLY };
    }
    const recipes = await this.recipeService.getAllowed(profile.rules);
    const options = MENU_PLAN_MEAL_TYPES.map((type) =>
      recipes
        .filter((recipe) => recipe.mealType === type)
        .map((recipe): RecipeOption => ({
          recipe,
          nutrition: this.nutritionService.calculateRecipe(recipe),
        })),
    );
    if (options.some((recipesOfMeal) => recipesOfMeal.length === 0)) {
      return { type: ChatResponseType.Text, message: NO_MENU_RECIPES_REPLY };
    }

    const plan = await this.openAiService.generateStructured(
      [
        {
          role: 'user',
          content: JSON.stringify({
            request: message,
            profile: toModelProfile(profile),
            recipes: Object.fromEntries(
              MENU_PLAN_MEAL_TYPES.map((type, i) => [
                type,
                options[i].map(({ recipe, nutrition }) => ({
                  id: recipe.id,
                  name: recipe.name,
                  perServing: roundToUnits(nutrition.perServing),
                  complete: nutrition.complete,
                })),
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
        const option = options[i].find(({ recipe }) => recipe.id === plan[mealType]);
        if (!option) {
          throw new AssistantInvalidOutputException();
        }
        return {
          mealType,
          servings: 1,
          recipeId: option.recipe.id,
          recipe: snapshotRecipe(option.recipe, option.nutrition),
        };
      }),
    };
    return {
      type: ChatResponseType.MenuReady,
      message: plan.message,
      menu: this.menuComposer.compose([day], profile),
    };
  }
}
