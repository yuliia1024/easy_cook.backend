import { Injectable, Logger } from '@nestjs/common';
import { ModelMessage } from 'ai';
import { z } from 'zod';
import {
  ChatResponseType,
  ChatStatusStep,
  ChatStreamEventType,
  MENU_MIN_DAYS,
  MENU_PLAN_CANDIDATE_POOL_FACTOR,
  MENU_PLAN_MAX_ATTEMPTS,
  MENU_PLAN_MEAL_TYPES,
  menuDayRetryMessage,
  menuPlanRetryMessage,
  NO_PROFILE_REPLY,
} from '../../../common/constants';
import { MenuRequest } from '../../../common/contracts';
import {
  ChatProgressEvent,
  ChatResponse,
  MacroValues,
  MenuComposition,
  ModelProvenance,
  ProfileContext,
  ResolvedDay,
} from '../../../common/types';
import { AssistantInvalidOutputException } from '../../../common/exceptions';
import { promptLabel } from '../../../common/utils';
import { ModelCallOptions, OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { RecipeWithIngredients } from '../../data-access/recipe/recipe.repository';
import { NutritionService, RecipeNutrition } from '../nutrition/nutrition.service';
import { RecipeService } from '../recipe/recipe.service';
import { MenuComposer } from './menu-composer';
import { findMenuShortage, hasEnoughRecipes, menuShortageReply } from './menu-shortage';
import { requestRules } from './menu-request';
import { fitServings, snapshotRecipe } from './menu-composition';
import {
  menuDayErrors,
  menuDayModelCall,
  otherDaysRecipeIds,
  replaceDay,
  withoutRecipes,
} from './menu-day';
import {
  candidatesPerMeal,
  labelCandidates,
  LabelledCandidates,
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

/** The allowed recipes with their nutrition and the labelled candidates. */
interface PreparedMenu extends LabelledCandidates {
  options: Map<string, RecipeOption>;
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
    const days = request.days ?? MENU_MIN_DAYS;
    const { context, recipes } = await this.allowedRecipes(request, profile, onProgress);
    const shortage = await this.shortageReply(recipes, context, profile, days);
    if (shortage) {
      return shortage;
    }
    const { options, candidates, recipeIds } = this.prepare(
      recipes,
      request,
      days,
      days,
      onProgress,
    );
    const {
      input,
      schema,
      options: callOptions,
    } = menuPlanModelCall(message, days, context, candidates, abortSignal);
    const resolve = (planned: PlannedDay[]): ResolvedDay[] =>
      this.fit(
        planned.map((meals, dayIndex) =>
          this.resolveDay(meals, dayIndex, null, recipeIds, options),
        ),
        request.caloriesKcal,
      );
    const { plan, generatedWith, attempts } = await this.generate(
      input,
      schema,
      callOptions,
      (planned) =>
        menuPlanErrors(planned, candidates, days, (d) =>
          this.menuComposer.compose(resolve(d), context),
        ),
      menuPlanRetryMessage,
      onProgress,
    );
    this.logger.log(
      `Menu of ${days} days planned in ${attempts} attempt(s) by ${generatedWith.modelId} with ${generatedWith.prompt}`,
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

  /**
   * Plans the day `dayIndex` of the menu `previous` again ("redo Tuesday"): the model picks only
   * that day's meals (`MENU_DAY_PROMPT`), among candidates without the recipes of the other days
   * (`withoutRecipes`), and the other days are copied from `previous` as they are, servings and
   * recipe snapshots included. The whole menu with the new day is validated on every attempt; the
   * errors on the new day go back to the model (`menuDayErrors`), the ones of the kept days stay
   * in the menu's issues. The new day keeps the date of the old one and its servings are fitted
   * to the daily calories of the request. Nothing is saved.
   */
  public async replanDay(
    message: string,
    request: MenuRequest,
    profile: ProfileContext | null,
    previous: ResolvedDay[],
    dayIndex: number,
    abortSignal?: AbortSignal,
    onProgress: (event: ChatProgressEvent) => void = () => undefined,
  ): Promise<ChatResponse> {
    const old = previous.find((day) => day.dayIndex === dayIndex);
    if (!old) {
      throw new Error(`The menu has no day ${dayIndex}`);
    }
    if (!profile) {
      return { type: ChatResponseType.Text, message: NO_PROFILE_REPLY };
    }
    const { context, recipes } = await this.allowedRecipes(request, profile, onProgress);
    const shortage = await this.shortageReply(recipes, context, profile, MENU_MIN_DAYS);
    if (shortage) {
      return shortage;
    }
    const { options, candidates, recipeIds } = this.prepare(
      withoutRecipes(recipes, otherDaysRecipeIds(previous, dayIndex)),
      request,
      MENU_MIN_DAYS,
      previous.length,
      onProgress,
    );
    const {
      input,
      schema,
      options: callOptions,
    } = menuDayModelCall(message, dayIndex, context, candidates, abortSignal);
    const resolve = (meals: PlannedDay): ResolvedDay[] =>
      replaceDay(
        previous,
        this.fit(
          [this.resolveDay(meals, dayIndex, old.date, recipeIds, options)],
          request.caloriesKcal,
        )[0],
      );
    const compose = (meals: PlannedDay): MenuComposition =>
      this.menuComposer.compose(resolve(meals), context);
    const { plan, generatedWith, attempts } = await this.generate(
      input,
      schema,
      callOptions,
      (planned) => menuDayErrors(planned, candidates, dayIndex, compose),
      menuDayRetryMessage,
      onProgress,
    );
    this.logger.log(
      `Day ${dayIndex + 1} of ${previous.length} planned again in ${attempts} attempt(s) by ${generatedWith.modelId} with ${generatedWith.prompt}`,
    );
    return {
      type: ChatResponseType.MenuReady,
      message: plan.message,
      menu: compose(plan.meals),
      days: resolve(plan.meals),
      generatedWith,
    };
  }

  /** The profile with the rules of the request and the recipes those rules allow. */
  private async allowedRecipes(
    request: MenuRequest,
    profile: ProfileContext,
    onProgress: (event: ChatProgressEvent) => void,
  ): Promise<{ context: ProfileContext; recipes: RecipeWithIngredients[] }> {
    onProgress({ type: ChatStreamEventType.Status, step: ChatStatusStep.SearchingBreakfasts });
    const context = { ...profile, rules: requestRules(profile.rules, request) };
    return { context, recipes: await this.recipeService.getAllowed(context.rules) };
  }

  /**
   * The reply that names the rules leaving too few of the allowed `recipes` for `days` days, or
   * `null` when there are enough.
   */
  private async shortageReply(
    recipes: RecipeWithIngredients[],
    context: ProfileContext,
    profile: ProfileContext,
    days: number,
  ): Promise<ChatResponse | null> {
    if (hasEnoughRecipes(recipes, days)) {
      return null;
    }
    const shortage = findMenuShortage(
      await this.recipeService.getAll(),
      context.rules,
      profile.rules,
      days,
    );
    if (!shortage) {
      return null;
    }
    this.logger.log(
      `Too few recipes for a ${days}-day menu: ${JSON.stringify(shortage.shortMeals)}`,
    );
    return { type: ChatResponseType.Text, message: menuShortageReply(shortage) };
  }

  /**
   * The recipes with their nutrition and the labelled candidates for `days` planned days.
   * `menuDays` is the length of the whole menu, for `menu_pending`.
   */
  private prepare(
    recipes: RecipeWithIngredients[],
    request: MenuRequest,
    days: number,
    menuDays: number,
    onProgress: (event: ChatProgressEvent) => void,
  ): PreparedMenu {
    const options = new Map<string, RecipeOption>(
      recipes.map((recipe) => [
        recipe.id,
        { recipe, nutrition: this.nutritionService.calculateRecipe(recipe) },
      ]),
    );
    const labelled = labelCandidates(
      this.candidates([...options.values()], days, request.caloriesKcal),
    );
    onProgress({
      type: ChatStreamEventType.MenuPending,
      days: menuDays,
      mealTypes: [...MENU_PLAN_MEAL_TYPES],
    });
    return { options, ...labelled };
  }

  /**
   * Asks the model until the plan has no `problemsOf`, up to `MENU_PLAN_MAX_ATTEMPTS` calls
   * (`planWithRetries`); still with problems after the last one, it is invalid output. Returns the
   * plan with the model and prompt version of the last call and the number of calls.
   */
  private async generate<T>(
    input: ModelMessage[],
    schema: z.ZodType<T>,
    callOptions: ModelCallOptions,
    problemsOf: (plan: T) => string[],
    retryMessage: (problems: string[]) => string,
    onProgress: (event: ChatProgressEvent) => void,
  ): Promise<{ plan: T; generatedWith: ModelProvenance; attempts: number }> {
    const status = (step: ChatStatusStep): void =>
      onProgress({ type: ChatStreamEventType.Status, step });
    let modelId = '';
    const attempts = await planWithRetries<T>(
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
        return problemsOf(plan);
      },
      MENU_PLAN_MAX_ATTEMPTS,
      retryMessage,
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
    return {
      plan,
      generatedWith: { modelId, prompt: promptLabel(callOptions.prompt) },
      attempts: attempts.length,
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

  /** The day with the recipes of the short ids the model picked, one serving each. */
  private resolveDay(
    meals: PlannedDay,
    dayIndex: number,
    date: Date | null,
    recipeIds: Map<string, string>,
    options: Map<string, RecipeOption>,
  ): ResolvedDay {
    return {
      dayIndex,
      date,
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
    };
  }

  /** The servings of the days fitted to `dailyKcal`, unchanged without it. */
  private fit(days: ResolvedDay[], dailyKcal: number | null): ResolvedDay[] {
    return dailyKcal === null ? days : fitServings(days, dailyKcal);
  }
}
