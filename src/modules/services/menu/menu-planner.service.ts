import { Injectable, Logger } from '@nestjs/common';
import {
  ChatResponseType,
  MENU_MIN_DAYS,
  MENU_PLAN_CANDIDATE_POOL_FACTOR,
  MENU_PLAN_MAX_ATTEMPTS,
  MENU_PLAN_MEAL_TYPES,
  MenuIssueSeverity,
  menuPlanRetryMessage,
  NO_MENU_RECIPES_REPLY,
  NO_PROFILE_REPLY,
} from '../../../common/constants';
import { MenuRequest } from '../../../common/contracts';
import { ChatResponse, MacroValues, MenuComposition, ProfileContext } from '../../../common/types';
import { AssistantInvalidOutputException } from '../../../common/exceptions';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { RecipeWithIngredients } from '../../data-access/recipe/recipe.repository';
import { NutritionService, RecipeNutrition } from '../nutrition/nutrition.service';
import { RecipeService } from '../recipe/recipe.service';
import { MenuComposer } from './menu-composer';
import { ResolvedDay, snapshotRecipe } from './menu-composition';
import {
  candidatesPerMeal,
  labelCandidates,
  MenuPlanCandidates,
  menuPlanModelCall,
  planDays,
  PlannedDay,
  planProblems,
  selectCandidates,
} from './menu-plan';

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
 * Plans a menu of `request.days` days (one when not given) from a chat request: for every day the
 * model picks a breakfast, a lunch, a snack and a dinner, one serving each, among candidates of the
 * recipes the dietary preferences allow (`selectCandidates`, rotated at random, by short ids),
 * knowing the profile goal, the daily target and the calories and macros of a serving. A plan with problems
 * (other days, a recipe that is not a candidate, an error of `validateMenu`) goes back to the
 * model with the problems, up to `MENU_PLAN_MAX_ATTEMPTS` calls; after the last one it is invalid
 * output. The menu comes with its issues against the profile. Nothing is saved.
 * Without a profile there are no rules to follow, so it asks to fill one in instead.
 */
@Injectable()
export class MenuPlannerService {
  private readonly logger = new Logger(MenuPlannerService.name);

  constructor(
    private readonly recipeService: RecipeService,
    private readonly nutritionService: NutritionService,
    private readonly openAiService: OpenAiService,
    private readonly menuComposer: MenuComposer,
  ) {}

  public async plan(
    message: string,
    request: MenuRequest,
    profile: ProfileContext | null,
    abortSignal?: AbortSignal,
  ): Promise<ChatResponse> {
    if (!profile) {
      return { type: ChatResponseType.Text, message: NO_PROFILE_REPLY };
    }
    const days = request.days ?? MENU_MIN_DAYS;
    const recipes = await this.recipeService.getAllowed(profile.rules);
    const options = new Map<string, RecipeOption>(
      recipes.map((recipe) => [
        recipe.id,
        { recipe, nutrition: this.nutritionService.calculateRecipe(recipe) },
      ]),
    );
    const { candidates, recipeIds } = labelCandidates(
      this.candidates([...options.values()], days, request.caloriesKcal),
    );
    if (MENU_PLAN_MEAL_TYPES.some((mealType) => candidates[mealType].length === 0)) {
      return { type: ChatResponseType.Text, message: NO_MENU_RECIPES_REPLY };
    }

    const {
      input,
      schema,
      options: callOptions,
    } = menuPlanModelCall(message, days, profile, candidates, abortSignal);
    const messages = [...input];
    for (let attempt = 1; attempt <= MENU_PLAN_MAX_ATTEMPTS; attempt++) {
      const plan = await this.openAiService.generateStructured([...messages], schema, callOptions);
      let problems = planProblems(plan, candidates, days);
      if (problems.length === 0) {
        const menu = this.compose(planDays(plan), recipeIds, options, profile);
        problems = menu.issues
          .filter((issue) => issue.severity === MenuIssueSeverity.Error)
          .map(({ message: issue }) => `${issue}.`);
        if (problems.length === 0) {
          this.logger.log(`Menu of ${days} days planned in ${attempt} attempt(s)`);
          return { type: ChatResponseType.MenuReady, message: plan.message, menu };
        }
      }
      this.logger.warn(
        `Menu plan attempt ${attempt} of ${MENU_PLAN_MAX_ATTEMPTS} has ${problems.length} problem(s): ${problems.join(' ')}`,
      );
      messages.push(
        { role: 'assistant', content: JSON.stringify(plan) },
        { role: 'user', content: menuPlanRetryMessage(problems) },
      );
    }
    this.logger.warn(`Menu plan failed after ${MENU_PLAN_MAX_ATTEMPTS} attempts`);
    throw new AssistantInvalidOutputException();
  }

  /** The candidates of every meal, rotated by a random offset so a new plan gets other ones. */
  private candidates(
    options: RecipeOption[],
    days: number,
    dailyKcal: number | null,
  ): MenuPlanCandidates {
    const count = candidatesPerMeal(days);
    const rotation = Math.floor(Math.random() * count * MENU_PLAN_CANDIDATE_POOL_FACTOR);
    return Object.fromEntries(
      MENU_PLAN_MEAL_TYPES.map((mealType) => [
        mealType,
        selectCandidates(
          options
            .filter(({ recipe }) => recipe.mealType === mealType)
            .map(({ recipe, nutrition }) => ({
              id: recipe.id,
              name: recipe.name,
              perServing: roundToUnits(nutrition.perServing),
              complete: nutrition.complete,
            })),
          mealType,
          dailyKcal,
          count,
          rotation,
        ),
      ]),
    ) as MenuPlanCandidates;
  }

  /** The days with the recipes of the short ids the model picked. */
  private compose(
    days: PlannedDay[],
    recipeIds: Map<string, string>,
    options: Map<string, RecipeOption>,
    profile: ProfileContext,
  ): MenuComposition {
    const resolved = days.map((meals, dayIndex): ResolvedDay => ({
      dayIndex,
      date: null,
      meals: MENU_PLAN_MEAL_TYPES.map((mealType) => {
        const { recipe, nutrition } = options.get(
          recipeIds.get(meals[mealType]) as string,
        ) as RecipeOption;
        return {
          mealType,
          servings: 1,
          recipeId: recipe.id,
          recipe: snapshotRecipe(recipe, nutrition),
        };
      }),
    }));
    return this.menuComposer.compose(resolved, profile);
  }
}
