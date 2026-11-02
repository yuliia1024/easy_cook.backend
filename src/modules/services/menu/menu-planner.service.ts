import { Injectable, Logger } from '@nestjs/common';
import {
  ChatResponseType,
  ChatStatusStep,
  ChatStreamEventType,
  MENU_MIN_DAYS,
  MENU_PLAN_CANDIDATE_POOL_FACTOR,
  MENU_PLAN_MAX_ATTEMPTS,
  MENU_PLAN_MEAL_TYPES,
  NO_PROFILE_REPLY,
} from '../../../common/constants';
import { MenuRequest } from '../../../common/contracts';
import {
  ChatProgressEvent,
  ChatResponse,
  MacroValues,
  MenuComposition,
  ProfileContext,
  ResolvedDay,
} from '../../../common/types';
import { AssistantInvalidOutputException } from '../../../common/exceptions';
import { promptLabel } from '../../../common/utils';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { RecipeWithIngredients } from '../../data-access/recipe/recipe.repository';
import { NutritionService, RecipeNutrition } from '../nutrition/nutrition.service';
import { RecipeService } from '../recipe/recipe.service';
import { MenuComposer } from './menu-composer';
import { findMenuShortage, hasEnoughRecipes, menuShortageReply } from './menu-shortage';
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
 * its meals with the recipe snapshots, and the model and prompt version that planned it
 * (`generatedWith`, of the last attempt). Nothing is saved.
 * The rules are the profile's with the constraints of the request added (`requestRules`), so
 * "without chicken" from the chat is enforced like an excluded ingredient of the profile.
 * Without a profile there are no rules to follow, so it asks to fill one in instead.
 * Before the model is called, every meal must have enough allowed recipes for the days
 * (`menuMinRecipes`); otherwise the reply names the rules that leave too few and offers to drop
 * one or plan fewer days (`findMenuShortage`), instead of a menu that repeats the same recipes.
 * `onProgress` hears the steps: looking for recipes, the shape of the menu once there are
 * candidates for every meal (`menu_pending`), then picking and checking on every attempt.
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
    onProgress: (event: ChatProgressEvent) => void = () => undefined,
  ): Promise<ChatResponse> {
    if (!profile) {
      return { type: ChatResponseType.Text, message: NO_PROFILE_REPLY };
    }
    const status = (step: ChatStatusStep): void =>
      onProgress({ type: ChatStreamEventType.Status, step });
    const days = request.days ?? MENU_MIN_DAYS;
    status(ChatStatusStep.SearchingBreakfasts);
    const context = { ...profile, rules: requestRules(profile.rules, request) };
    const recipes = await this.recipeService.getAllowed(context.rules);
    if (!hasEnoughRecipes(recipes, days)) {
      const shortage = findMenuShortage(
        await this.recipeService.getAll(),
        context.rules,
        profile.rules,
        days,
      );
      if (shortage) {
        this.logger.log(
          `Too few recipes for a ${days}-day menu: ${JSON.stringify(shortage.shortMeals)}`,
        );
        return { type: ChatResponseType.Text, message: menuShortageReply(shortage) };
      }
    }
    const options = new Map<string, RecipeOption>(
      recipes.map((recipe) => [
        recipe.id,
        { recipe, nutrition: this.nutritionService.calculateRecipe(recipe) },
      ]),
    );
    const { candidates, recipeIds } = labelCandidates(
      this.candidates([...options.values()], days, request.caloriesKcal),
    );
    onProgress({
      type: ChatStreamEventType.MenuPending,
      days,
      mealTypes: [...MENU_PLAN_MEAL_TYPES],
    });

    const {
      input,
      schema,
      options: callOptions,
    } = menuPlanModelCall(message, days, context, candidates, abortSignal);
    const resolve = (planned: PlannedDay[]): ResolvedDay[] =>
      this.resolve(planned, recipeIds, options, request.caloriesKcal);
    const compose = (plan: PlannedDay[]): MenuComposition =>
      this.menuComposer.compose(resolve(plan), context);
    let modelId = '';
    const attempts = await planWithRetries(
      input,
      async (messages) => {
        status(ChatStatusStep.PickingLunches);
        const result = await this.openAiService.generateStructuredResult(
          messages,
          schema,
          callOptions,
        );
        modelId = result.modelId;
        return result.output;
      },
      (plan) => {
        status(ChatStatusStep.CheckingConstraints);
        return menuPlanErrors(plan, candidates, days, compose);
      },
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
    const generatedWith = { modelId, prompt: promptLabel(callOptions.prompt) };
    this.logger.log(
      `Menu of ${days} days planned in ${attempts.length} attempt(s) by ${generatedWith.modelId} with ${generatedWith.prompt}`,
    );
    const resolved = resolve(planDays(plan));
    return {
      type: ChatResponseType.MenuReady,
      message: plan.message,
      menu: this.menuComposer.compose(resolved, context),
      days: resolved,
      generatedWith,
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
