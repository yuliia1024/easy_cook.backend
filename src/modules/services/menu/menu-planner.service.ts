import { Injectable, Logger } from '@nestjs/common';
import {
  ChatResponseType,
  MENU_MIN_DAYS,
  MENU_PLAN_CANDIDATE_POOL_FACTOR,
  MENU_PLAN_MAX_ATTEMPTS,
  MENU_PLAN_MEAL_TYPES,
  NO_MENU_RECIPES_REPLY,
  NO_PROFILE_REPLY,
} from '../../../common/constants';
import { MenuRequest } from '../../../common/contracts';
import {
  ChatResponse,
  MacroValues,
  MenuComposition,
  ProfileContext,
  ResolvedDay,
} from '../../../common/types';
import { AssistantInvalidOutputException } from '../../../common/exceptions';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { RecipeWithIngredients } from '../../data-access/recipe/recipe.repository';
import { NutritionService, RecipeNutrition } from '../nutrition/nutrition.service';
import { RecipeService } from '../recipe/recipe.service';
import { MenuComposer } from './menu-composer';
import { requestRules } from './menu-request';
import { fitServings, snapshotRecipe } from './menu-composition';
import {
  candidatesPerMeal,
  labelCandidates,
  MenuPlanCandidates,
  menuPlanErrors,
  menuPlanModelCall,
  planDays,
  PlannedDay,
  planWithRetries,
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
 * model picks a breakfast, a lunch, a snack and a dinner among candidates of the
 * recipes the dietary preferences allow (`selectCandidates`, rotated at random, by short ids),
 * knowing the profile goal, the daily target and the calories and macros of a serving. A plan with problems
 * (other days, a recipe that is not a candidate, an error of `validateMenu`) goes back to the
 * model with the problems, up to `MENU_PLAN_MAX_ATTEMPTS` calls; after the last one it is invalid
 * output. The servings of every day are fitted to the daily calories of the request
 * (`fitServings`), one each without them. The menu comes with its issues against the profile and
 * its meals with the recipe snapshots. Nothing is saved.
 * The rules are the profile's with the constraints of the request added (`requestRules`), so
 * "without chicken" from the chat is enforced like an excluded ingredient of the profile.
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
    const context = { ...profile, rules: requestRules(profile.rules, request) };
    const recipes = await this.recipeService.getAllowed(context.rules);
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
    } = menuPlanModelCall(message, days, context, candidates, abortSignal);
    const resolve = (planned: PlannedDay[]): ResolvedDay[] =>
      this.resolve(planned, recipeIds, options, request.caloriesKcal);
    const compose = (plan: PlannedDay[]): MenuComposition =>
      this.menuComposer.compose(resolve(plan), context);
    const attempts = await planWithRetries(
      input,
      (messages) => this.openAiService.generateStructured(messages, schema, callOptions),
      (plan) => menuPlanErrors(plan, candidates, days, compose),
    );
    attempts.forEach(({ problems }, i) => {
      if (problems.length > 0) {
        this.logger.warn(
          `Menu plan attempt ${i + 1} of ${MENU_PLAN_MAX_ATTEMPTS} has ${problems.length} problem(s): ${problems.join(' ')}`,
        );
      }
    });
    const { plan, problems } = attempts[attempts.length - 1];
    if (problems.length > 0) {
      this.logger.warn(`Menu plan failed after ${attempts.length} attempts`);
      throw new AssistantInvalidOutputException();
    }
    this.logger.log(`Menu of ${days} days planned in ${attempts.length} attempt(s)`);
    const resolved = resolve(planDays(plan));
    return {
      type: ChatResponseType.MenuReady,
      message: plan.message,
      menu: this.menuComposer.compose(resolved, context),
      days: resolved,
    };
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

  /** The days with the recipes of the short ids the model picked, servings fitted to `dailyKcal`. */
  private resolve(
    days: PlannedDay[],
    recipeIds: Map<string, string>,
    options: Map<string, RecipeOption>,
    dailyKcal: number | null,
  ): ResolvedDay[] {
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
    return dailyKcal === null ? resolved : fitServings(resolved, dailyKcal);
  }
}
