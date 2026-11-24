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
  MENU_PLAN_WISHED_SHARE,
  menuPlanRetryMessage,
  MealType,
  NO_PROFILE_REPLY,
  WISH_OFFER_RECIPES_MAX,
  wishOfferReply,
} from '../../../common/constants';
import { MenuRequest, WishOffer } from '../../../common/contracts';
import {
  ChatProgressEvent,
  ChatResponse,
  MacroValues,
  MenuComposition,
  ModelProvenance,
  PreferenceRules,
  ProfileContext,
  RecipeSnapshot,
  ResolvedDay,
} from '../../../common/types';
import { AssistantInvalidOutputException } from '../../../common/exceptions';
import { promptLabel } from '../../../common/utils';
import { ModelCallOptions, LlmService } from '../../../providers/llm/llm.service';
import { RecipeWithIngredients } from '../../data-access/recipe/recipe.repository';
import { NutritionService, RecipeNutrition } from '../nutrition/nutrition.service';
import { RecipeService } from '../recipe/recipe.service';
import { RecipeSearchService } from '../recipe-search/recipe-search.service';
import { MenuComposer } from './menu-composer';
import { findMenuShortage, hasEnoughRecipes, menuShortageReply } from './menu-shortage';
import { requestRules } from './menu-request';
import { isDislikedFood, searchFiltersOf } from './menu-rules';
import { fitServings, snapshotRecipe } from './menu-composition';
import { changedSlots, outsideScope, violatingSlots, widenReplacement } from './menu-diff';
import { replaceParts, replacedSlots, ReplacementModelCall } from './menu-replacement';
import { MenuReplacement } from './menu-target';
import {
  bestAttempt,
  candidatesPerMeal,
  labelCandidates,
  LabelledCandidates,
  MenuPlanCandidates,
  menuPlanErrors,
  MenuPlanMealType,
  menuPlanModelCall,
  menuPlanRepeats,
  planDays,
  PlannedDay,
  planWithRetries,
  selectCandidates,
} from './menu-plan';

interface RecipeOption {
  recipe: RecipeWithIngredients;
  nutrition: RecipeNutrition;
}

/**
 * A recipe with the calories and macros of a serving, before it is a candidate; `disliked` when
 * it has a disliked food of the rules (`selectCandidates` offers it only for want of others).
 */
type CandidateRecipe = Pick<
  RecipeSnapshot,
  'id' | 'name' | 'mealType' | 'perServing' | 'complete'
> & { disliked: boolean };

/** Per meal, the ids of the allowed recipes the search found for the wishes, best first. */
type WishedRecipes = Partial<Record<MenuPlanMealType, string[]>>;

/** The wished recipes of every meal, or the offer to make when none fits the wishes. */
interface WishSearch {
  wished: WishedRecipes;
  offer: WishOffer | null;
}

/** The recipes of an accepted offer that are still allowed, by meal, in the offer's order. Pure. */
export function offeredRecipes(
  offer: WishOffer,
  recipes: Pick<RecipeWithIngredients, 'id'>[],
): WishedRecipes {
  const allowed = new Set(recipes.map(({ id }) => id));
  const wished: WishedRecipes = {};
  for (const { id, mealType } of offer.recipes) {
    const meal = mealType as MenuPlanMealType;
    if (allowed.has(id) && MENU_PLAN_MEAL_TYPES.includes(meal)) {
      wished[meal] = [...(wished[meal] ?? []), id];
    }
  }
  return wished;
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
 * output. A plan that repeats recipes (`varietyProblems`) goes back too, but is accepted when no
 * attempt is better (`bestAttempt`). The servings of every day are fitted to the daily calories of the request
 * (`fitServings`), one each without them. The menu comes with its issues against the profile and
 * its meals with the recipe snapshots, and the model and prompt version that planned it
 * (`generatedWith`, of the attempt used). Nothing is saved.
 * The rules are the profile's with the constraints of the request added (`requestRules`), so
 * "without chicken" from the chat is enforced like an excluded ingredient of the profile.
 * Without a profile there are no rules to follow, so it asks to fill one in instead.
 * Before the model is called, every meal must have enough allowed recipes for the days
 * (`menuMinRecipes`); otherwise the reply names the rules that leave too few and offers to drop
 * one or plan fewer days (`findMenuShortage`), instead of a menu that repeats the same recipes.
 * With `wishes` in the request ("more fish"), the recipe search (`RecipeSearchService`) finds the
 * allowed recipes of every meal that fit them, and they take up to `MENU_PLAN_WISHED_SHARE` of
 * the candidates (`selectCandidates`); the calorie pool gives the rest. When nothing fits the
 * wishes ("sushi"), no menu is planned: the reply offers the closest recipes (`WishOffer`), and a
 * menu with them is planned once the user accepts (`acceptedOffer`).
 * `onProgress` hears the steps: looking for recipes, the shape of the menu once there are
 * candidates for every meal (`menu_pending`), then picking and checking on every attempt.
 */
@Injectable()
export class MenuPlannerService {
  private readonly logger = new Logger(MenuPlannerService.name);

  constructor(
    private readonly recipeService: RecipeService,
    private readonly recipeSearchService: RecipeSearchService,
    private readonly nutritionService: NutritionService,
    private readonly llmService: LlmService,
    private readonly menuComposer: MenuComposer,
  ) {}

  /**
   * `acceptedOffer`: the wish offer the user accepted; its recipes stand for the wishes, without a
   * new search.
   */
  public async plan(
    message: string,
    request: MenuRequest,
    profile: ProfileContext | null,
    abortSignal?: AbortSignal,
    onProgress: (event: ChatProgressEvent) => void = () => undefined,
    acceptedOffer: WishOffer | null = null,
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
    const { wished, offer } = acceptedOffer
      ? { wished: offeredRecipes(acceptedOffer, recipes), offer: null }
      : await this.wishedRecipes(request.wishes, context.rules, recipes, days, abortSignal);
    if (offer) {
      return {
        type: ChatResponseType.WishOffer,
        message: wishOfferReply(
          offer.wishes,
          offer.recipes.map(({ name }) => name),
        ),
        offer,
      };
    }
    const { options, candidates, recipeIds } = this.prepare(
      recipes,
      request,
      context.rules,
      days,
      onProgress,
      wished,
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
      (planned) => menuPlanRepeats(planned, candidates, days),
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
   * Replaces the days and the meals of `replacement` in the menu `previous` ("redo Monday and
   * Thursday", "another dinner on Wednesday and lunch on Friday") by `replaceParts`: one model
   * call with its retries for every part, among the allowed recipes without those already in the
   * menu, those replaced and `rejectedRecipeIds` (dropped by earlier versions), and everything
   * else copied from `previous` as it is, servings and recipe snapshots included. The meals of
   * `previous` that break the rules of the request (a constraint it adds, preferences changed since)
   * are replaced too (`widenReplacement`); when that is every day, the whole menu is planned again
   * (`plan`). A change outside the parts replaced (`changedSlots`) is a bug and throws. The whole request ends in one menu with the messages of every part; its provenance
   * is the model of the last call and every prompt version used. Nothing is saved.
   */
  public async replan(
    message: string,
    request: MenuRequest,
    profile: ProfileContext | null,
    previous: ResolvedDay[],
    replacement: MenuReplacement,
    abortSignal?: AbortSignal,
    onProgress: (event: ChatProgressEvent) => void = () => undefined,
    rejectedRecipeIds: ReadonlySet<string> = new Set(),
  ): Promise<ChatResponse> {
    if (!profile) {
      return { type: ChatResponseType.Text, message: NO_PROFILE_REPLY };
    }
    const breaking = violatingSlots(
      this.menuComposer.compose(previous, {
        ...profile,
        rules: requestRules(profile.rules, request),
      }).issues,
      previous,
    );
    const parts = widenReplacement(replacement, breaking, previous);
    if (!parts) {
      this.logger.log(
        `${breaking.length} meal(s) of ${previous.length} days break the rules: the whole menu is planned again`,
      );
      return this.plan(
        message,
        { ...request, days: previous.length },
        profile,
        abortSignal,
        onProgress,
      );
    }
    const { context, recipes } = await this.allowedRecipes(request, profile, onProgress);
    const shortage = await this.shortageReply(recipes, context, profile, MENU_MIN_DAYS);
    if (shortage) {
      return shortage;
    }
    // A replacement takes the recipes that fit the wishes; it never stops for an offer.
    const { wished } = await this.wishedRecipes(
      request.wishes,
      context.rules,
      recipes,
      MENU_MIN_DAYS,
      abortSignal,
    );
    onProgress({
      type: ChatStreamEventType.MenuPending,
      days: previous.length,
      mealTypes: [...MENU_PLAN_MEAL_TYPES],
    });
    const compose = (days: ResolvedDay[]): MenuComposition =>
      this.menuComposer.compose(days, context);
    let modelId = '';
    let attempts = 0;
    const prompts = new Set<string>();
    const ask = async <T>(
      { input, schema, options }: ReplacementModelCall<T>,
      problemsOf: (plan: T) => string[],
      retryMessage: (problems: string[]) => string,
    ): Promise<T> => {
      const generated = await this.generate(
        input,
        schema,
        { ...options, abortSignal },
        problemsOf,
        retryMessage,
        onProgress,
      );
      modelId = generated.generatedWith.modelId;
      prompts.add(generated.generatedWith.prompt);
      attempts += generated.attempts;
      return generated.plan;
    };
    const replaced = await replaceParts(
      parts,
      {
        request: message,
        profile: context,
        previous,
        recipes: recipes.map((recipe) =>
          snapshotRecipe(recipe, this.nutritionService.calculateRecipe(recipe)),
        ),
        rejectedRecipeIds,
        dailyKcal: request.caloriesKcal,
        label: (allowed) =>
          labelCandidates(
            this.candidates(
              allowed.map((recipe) => ({
                ...recipe,
                disliked: recipe.ingredients.some(({ foodName, foodNameEn }) =>
                  isDislikedFood(foodName, foodNameEn, context.rules),
                ),
              })),
              MENU_MIN_DAYS,
              request.caloriesKcal,
              wished,
            ),
          ),
        compose,
      },
      ask,
    );
    if (replaced.days === null) {
      throw new AssistantInvalidOutputException();
    }
    const outside = outsideScope(
      changedSlots(previous, replaced.days),
      replacedSlots(parts, previous),
    );
    if (outside.length > 0) {
      throw new Error(`The menu changed outside the parts replaced: ${JSON.stringify(outside)}`);
    }
    const generatedWith = { modelId, prompt: [...prompts].join(', ') };
    this.logger.log(
      `${parts.days.length} day(s) and ${parts.meals.length} meal(s) of ${previous.length} days replaced${breaking.length > 0 ? ` (${breaking.length} meal(s) breaking the rules)` : ''} in ${attempts} attempt(s) by ${generatedWith.modelId} with ${generatedWith.prompt}`,
    );
    return {
      type: ChatResponseType.MenuReady,
      message: replaced.messages.join(' '),
      menu: compose(replaced.days),
      days: replaced.days,
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
   * The allowed `recipes` of every meal the recipe search finds for `wishes`, best first, as many
   * as the wishes may take of the candidates for `days` days; none without wishes. A meal with no
   * allowed recipe that matches the wishes (only similar ones) gets none; when no meal found a fit, the
   * closest allowed recipes become an `offer` to ask the user about. A failed search plans
   * without the wishes: the model still reads them in the request.
   */
  private async wishedRecipes(
    wishes: string | null,
    rules: PreferenceRules,
    recipes: RecipeWithIngredients[],
    days: number,
    abortSignal?: AbortSignal,
  ): Promise<WishSearch> {
    if (wishes === null) {
      return { wished: {}, offer: null };
    }
    const allowed = new Map(recipes.map((recipe) => [recipe.id, recipe]));
    const wanted = Math.ceil(candidatesPerMeal(days) * MENU_PLAN_WISHED_SHARE);
    try {
      // One embedding of the wishes, one search per meal.
      const results = await this.recipeSearchService.searchEach(
        // Excluded ingredients are only checked here, so a few more than wanted.
        { text: wishes, limit: wanted * 2 },
        MENU_PLAN_MEAL_TYPES.map((mealType) => ({
          mealType,
          ...searchFiltersOf(rules.diets, rules.allergies),
        })),
        abortSignal,
      );
      // A meal fits the wishes only by a recipe the rules allow.
      const found = MENU_PLAN_MEAL_TYPES.map((mealType, i) => {
        const hits = results[i].hits.filter(({ recipe }) => allowed.has(recipe.id));
        return { mealType, matched: hits.some(({ match }) => match), hits };
      });
      const wished: WishedRecipes = Object.fromEntries(
        found
          .filter(({ matched }) => matched)
          .map(({ mealType, hits }) => [
            mealType,
            hits
              .filter(({ match }) => match)
              .slice(0, wanted)
              .map(({ recipe }) => recipe.id),
          ]),
      );
      if (Object.keys(wished).length > 0) {
        return { wished, offer: null };
      }
      const closest = found
        .flatMap(({ hits }) => hits)
        .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0) || b.score - a.score)
        .slice(0, WISH_OFFER_RECIPES_MAX);
      return {
        wished: {},
        offer:
          closest.length > 0
            ? {
                wishes,
                recipes: closest.map(({ recipe }) => ({
                  id: recipe.id,
                  name: recipe.name,
                  mealType: recipe.mealType as MealType,
                })),
              }
            : null,
      };
    } catch (error) {
      if (abortSignal?.aborted) {
        throw error;
      }
      this.logger.warn(
        `Recipe search for the wishes failed, planning without it: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { wished: {}, offer: null };
    }
  }

  /** The recipes with their nutrition and the labelled candidates for `days` planned days. */
  private prepare(
    recipes: RecipeWithIngredients[],
    request: MenuRequest,
    rules: PreferenceRules,
    days: number,
    onProgress: (event: ChatProgressEvent) => void,
    wished: WishedRecipes,
  ): PreparedMenu {
    const options = new Map<string, RecipeOption>(
      recipes.map((recipe) => [
        recipe.id,
        { recipe, nutrition: this.nutritionService.calculateRecipe(recipe) },
      ]),
    );
    const labelled = labelCandidates(
      this.candidates(
        [...options.values()].map(({ recipe, nutrition }) => ({
          id: recipe.id,
          name: recipe.name,
          mealType: recipe.mealType,
          perServing: nutrition.perServing,
          complete: nutrition.complete,
          disliked: recipe.ingredients.some(({ foodItem }) =>
            isDislikedFood(foodItem.name, foodItem.nameEn, rules),
          ),
        })),
        days,
        request.caloriesKcal,
        wished,
      ),
    );
    onProgress({
      type: ChatStreamEventType.MenuPending,
      days,
      mealTypes: [...MENU_PLAN_MEAL_TYPES],
    });
    return { options, ...labelled };
  }

  /**
   * Asks the model until the plan has no `problemsOf` and no `softProblemsOf`, up to
   * `MENU_PLAN_MAX_ATTEMPTS` calls (`planWithRetries`); when every attempt has `problemsOf`, it is
   * invalid output. Returns the plan (`bestAttempt`) with the model and prompt version of its call
   * and the number of attempts.
   */
  private async generate<T>(
    input: ModelMessage[],
    schema: z.ZodType<T>,
    callOptions: ModelCallOptions,
    problemsOf: (plan: T) => string[],
    retryMessage: (problems: string[]) => string,
    onProgress: (event: ChatProgressEvent) => void,
    softProblemsOf?: (plan: T) => string[],
  ): Promise<{ plan: T; generatedWith: ModelProvenance; attempts: number }> {
    const status = (step: ChatStatusStep): void =>
      onProgress({ type: ChatStreamEventType.Status, step });
    const modelIds: string[] = [];
    const attempts = await planWithRetries<T>(
      input,
      async (messages) => {
        status(ChatStatusStep.PickingLunches);
        const result = await this.llmService.generateStructuredResult(
          messages,
          schema,
          callOptions,
        );
        modelIds.push(result.modelId);
        return result.output;
      },
      (plan) => {
        status(ChatStatusStep.CheckingConstraints);
        return problemsOf(plan);
      },
      MENU_PLAN_MAX_ATTEMPTS,
      retryMessage,
      softProblemsOf,
    );
    attempts.forEach((attempt, i) => {
      const problems = [...attempt.problems, ...attempt.softProblems];
      if (problems.length > 0) {
        this.logger.warn(
          `Menu plan attempt ${i + 1} of ${MENU_PLAN_MAX_ATTEMPTS} has ${problems.length} problem(s): ${problems.join(' ')}`,
        );
      }
    });
    const best = bestAttempt(attempts);
    if (best.problems.length > 0) {
      this.logger.warn(`Menu plan failed after ${attempts.length} attempts`);
      throw new AssistantInvalidOutputException();
    }
    if (best.softProblems.length > 0) {
      this.logger.warn(
        `Menu plan attempt ${attempts.indexOf(best) + 1} accepted with ${best.softProblems.length} problem(s) after ${attempts.length} attempts`,
      );
    }
    return {
      plan: best.plan,
      generatedWith: {
        modelId: modelIds[attempts.indexOf(best)],
        prompt: promptLabel(callOptions.prompt),
      },
      attempts: attempts.length,
    };
  }

  /**
   * The candidates of every meal, rotated by a random offset so a new plan gets other ones, the
   * `wished` recipes first, the `disliked` ones only for want of others.
   */
  private candidates(
    recipes: CandidateRecipe[],
    days: number,
    dailyKcal: number | null,
    wished: WishedRecipes = {},
  ): MenuPlanCandidates {
    const count = candidatesPerMeal(days);
    const rotation = Math.floor(Math.random() * count * MENU_PLAN_CANDIDATE_POOL_FACTOR);
    const disliked = new Set(recipes.filter((recipe) => recipe.disliked).map(({ id }) => id));
    return Object.fromEntries(
      MENU_PLAN_MEAL_TYPES.map((mealType) => [
        mealType,
        selectCandidates(
          recipes
            .filter((recipe) => recipe.mealType === mealType)
            .map(({ id, name, perServing, complete }) => ({
              id,
              name,
              perServing: roundToUnits(perServing),
              complete,
            })),
          mealType,
          dailyKcal,
          count,
          rotation,
          wished[mealType],
          disliked,
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
