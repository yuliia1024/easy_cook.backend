import { Injectable } from '@nestjs/common';
import {
  ChatStreamEventType,
  ChatToolName,
  FOOD_NUTRITION_MAX_RESULTS,
  PreferenceChangeStatus,
  SaveMenuStatus,
  SEARCH_RECIPES_DEFAULT_RESULTS,
  SEARCH_RECIPES_SCAN_LIMIT,
  SortOrder,
} from '../../../common/constants';
import {
  ApplyPreferenceChangeInputSchema,
  CalculateNutritionInput,
  CalculateNutritionInputSchema,
  GetFoodNutritionInput,
  GetFoodNutritionInputSchema,
  GetRecipeDetailsInput,
  GetRecipeDetailsInputSchema,
  PlanMenuInputSchema,
  PreferenceChange,
  PreferenceChangeSchema,
  ReviseMenuInputSchema,
  SaveMenuInputSchema,
  SearchRecipesInput,
  SearchRecipesInputSchema,
} from '../../../common/contracts';
import {
  CalculateNutritionResult,
  GetFoodNutritionResult,
  PreferenceRules,
  ProfileContext,
  RecipeDetailsResult,
  SaveMenuResult,
  SearchRecipesResult,
} from '../../../common/types';
import { MenuDraftNotFoundException } from '../../../common/exceptions';
import { RecipeWithIngredients } from '../../data-access/recipe/recipe.repository';
import { ConversationService } from '../conversation/conversation.service';
import { latestSuggestedVersion } from '../conversation/suggested-menu';
import { FoodItemService } from '../food-item/food-item.service';
import { dietTagsSatisfying } from '../menu/menu-rules';
import { MenuService } from '../menu/menu.service';
import { PreferenceChangeService } from '../preference-change/preference-change.service';
import { NutritionService, RecipeNutrition } from '../nutrition/nutrition.service';
import { RecipeService } from '../recipe/recipe.service';
import {
  ChatTool,
  ChatToolWriteResult,
  readTool,
  serviceCallTool,
  writeTool,
} from './chat-tool-registry';
import {
  toFoodNutrition,
  toNutritionCalculation,
  toRecipeDetails,
  toRecipeSummary,
} from './chat-tool-results';

/**
 * The tools of the chat model. The read tools only read, through the services the API uses
 * (`RecipeService`, `FoodItemService`) and the deterministic `NutritionService`; the menu tools
 * (`plan_menu`, `revise_menu`) are service calls the backend runs on the path of a classified menu
 * request, so the model decides when to plan but never what is checked or saved. `save_menu`
 * confirms the latest menu the conversation suggested through `MenuService.confirm`, as the
 * confirm button of the API does; the conversation, not the model, names the menu. A change of the
 * dietary preferences is only proposed (`propose_preference_change`, kept with the reply) and
 * applied once the user says yes (`apply_preference_change`, `PreferenceChangeService`).
 */
@Injectable()
export class ChatToolsService {
  constructor(
    private readonly recipeService: RecipeService,
    private readonly foodItemService: FoodItemService,
    private readonly nutritionService: NutritionService,
    private readonly conversationService: ConversationService,
    private readonly menuService: MenuService,
    private readonly preferenceChangeService: PreferenceChangeService,
  ) {}

  /**
   * Every tool, the recipes marked against the rules of `profile`; `save_menu` saves the menu of
   * the conversation `conversationId`.
   */
  public tools(profile: ProfileContext | null, conversationId: string): ChatTool[] {
    const rules = profile?.rules ?? null;
    return [
      readTool({
        name: ChatToolName.SearchRecipes,
        description:
          'Searches the recipes of the app by name, meal, diet and calories of a serving. ' +
          'fitsProfile false means the user must not eat it.',
        inputSchema: SearchRecipesInputSchema,
        execute: (input: SearchRecipesInput) => this.searchRecipes(input, rules),
      }),
      readTool({
        name: ChatToolName.GetRecipeDetails,
        description:
          'The ingredients, instructions, allergens and calories and macros of a serving of one recipe.',
        inputSchema: GetRecipeDetailsInputSchema,
        execute: (input: GetRecipeDetailsInput) => this.getRecipeDetails(input, rules),
      }),
      readTool({
        name: ChatToolName.GetFoodNutrition,
        description:
          'Calories and macros of the foods whose name matches, per 100 g and for a quantity. ' +
          'Values are for the food in its state (raw, dry, boiled); null is unknown.',
        inputSchema: GetFoodNutritionInputSchema,
        execute: (input: GetFoodNutritionInput) => this.getFoodNutrition(input),
      }),
      readTool({
        name: ChatToolName.CalculateNutrition,
        description:
          'Adds up the calories and macros of foods by id and grams, in total and per serving. ' +
          'Use it instead of doing the maths yourself.',
        inputSchema: CalculateNutritionInputSchema,
        execute: (input: CalculateNutritionInput) => this.calculateNutrition(input),
      }),
      serviceCallTool({
        name: ChatToolName.PlanMenu,
        description:
          'Plans a new menu when the user asks for one. The app plans, checks and saves it and ' +
          'shows it to the user: never write a menu yourself.',
        inputSchema: PlanMenuInputSchema,
      }),
      serviceCallTool({
        name: ChatToolName.ReviseMenu,
        description:
          'Changes days or meals of the latest menu the chat suggested. The app plans the change, ' +
          'checks and saves it.',
        inputSchema: ReviseMenuInputSchema,
      }),
      writeTool({
        name: ChatToolName.SaveMenu,
        description:
          'Saves the latest menu you suggested in this chat, as the Save button does. Call it only ' +
          'when the user asks to save it or agrees to your question whether to save it. Takes no ' +
          'arguments: the app knows which menu.',
        inputSchema: SaveMenuInputSchema,
        execute: () => this.saveMenu(conversationId),
      }),
      writeTool({
        name: ChatToolName.ProposePreferenceChange,
        description:
          'Proposes one change of the saved dietary preferences (diets, allergies, excluded ' +
          'ingredients, disliked foods). It changes nothing: ask the user whether to apply it.',
        inputSchema: PreferenceChangeSchema,
        execute: (input: PreferenceChange) => this.proposePreferenceChange(input),
      }),
      writeTool({
        name: ChatToolName.ApplyPreferenceChange,
        description:
          'Applies the preference change you proposed in your last reply. Call it only when the ' +
          'user says yes to it. Takes no arguments: the app knows which change.',
        inputSchema: ApplyPreferenceChangeInputSchema,
        notAfter: [ChatToolName.ProposePreferenceChange],
        execute: () => this.applyPreferenceChange(conversationId),
      }),
    ];
  }

  /**
   * Checks the change and streams it for the client to confirm; the reply keeps it. Writes
   * nothing. A change in effect already is no proposal (`already_applied`, no event).
   */
  public async proposePreferenceChange(change: PreferenceChange): Promise<ChatToolWriteResult> {
    const result = await this.preferenceChangeService.propose(change);
    return {
      output: result,
      event:
        result.status === PreferenceChangeStatus.Proposed
          ? { type: ChatStreamEventType.PreferenceChangeProposed, change: result.change }
          : null,
    };
  }

  /**
   * Applies the change the latest reply proposed; 404 (`not_found`) when it proposed none, 400
   * (`rejected`) for the removal of an allergy, which only the confirm button applies.
   */
  public async applyPreferenceChange(conversationId: string): Promise<ChatToolWriteResult> {
    const result = await this.preferenceChangeService.applyInChat(conversationId);
    return {
      output: result,
      event: { type: ChatStreamEventType.PreferencesUpdated, change: result.change },
    };
  }

  /**
   * Confirms the latest menu version the conversation suggested (`MenuService.confirm`: checked
   * again against the current preferences first). A version already confirmed is not confirmed
   * again: the result says so. 404 (`not_found` for the model) for a conversation of another
   * profile or without a suggested menu, 400 (`rejected`) for a version that breaks the rules now.
   */
  public async saveMenu(conversationId: string): Promise<ChatToolWriteResult> {
    const conversation = await this.conversationService.getById(conversationId);
    const draft = latestSuggestedVersion(conversation.messages);
    if (!draft) {
      throw new MenuDraftNotFoundException();
    }
    const menu = await this.menuService.getById(draft.menuId);
    const alreadySaved = menu.confirmedVersionId === draft.versionId;
    const saved = alreadySaved
      ? menu
      : await this.menuService.confirm(draft.menuId, draft.versionId);
    return {
      output: {
        status: alreadySaved ? SaveMenuStatus.AlreadySaved : SaveMenuStatus.Saved,
        title: saved.title,
      } satisfies SaveMenuResult,
      event: { type: ChatStreamEventType.MenuSaved, menuId: saved.id, versionId: draft.versionId },
    };
  }

  /**
   * One page of recipes by name; with `maxKcalPerServing`, the first `SEARCH_RECIPES_SCAN_LIMIT`
   * are read and filtered here, since calories are not stored per serving.
   */
  public async searchRecipes(
    { query, mealType, diet, maxKcalPerServing, limit }: SearchRecipesInput,
    rules: PreferenceRules | null,
  ): Promise<SearchRecipesResult> {
    const wanted = limit ?? SEARCH_RECIPES_DEFAULT_RESULTS;
    const { items, total } = await this.recipeService.getPage(
      {
        search: query ?? undefined,
        mealType: mealType ?? undefined,
        dietTypeGroups: diet ? [[...dietTagsSatisfying(diet)]] : undefined,
      },
      {
        page: 1,
        limit: maxKcalPerServing === null ? wanted : SEARCH_RECIPES_SCAN_LIMIT,
        sortOrder: SortOrder.Asc,
      },
    );
    const matching = items
      .map((recipe) => ({ recipe, nutrition: this.nutritionOf(recipe) }))
      .filter(
        ({ nutrition }) =>
          maxKcalPerServing === null || nutrition.perServing.kcal <= maxKcalPerServing,
      );
    return {
      recipes: matching
        .slice(0, wanted)
        .map(({ recipe, nutrition }) => toRecipeSummary(recipe, nutrition, rules)),
      more: matching.length > wanted || items.length < total,
    };
  }

  /** 404 (`not_found` for the model) for an unknown recipe. */
  public async getRecipeDetails(
    { recipeId }: GetRecipeDetailsInput,
    rules: PreferenceRules | null,
  ): Promise<RecipeDetailsResult> {
    const recipe = await this.recipeService.getById(recipeId);
    return toRecipeDetails(recipe, this.nutritionOf(recipe), rules);
  }

  public async getFoodNutrition({
    query,
    quantityG,
  }: GetFoodNutritionInput): Promise<GetFoodNutritionResult> {
    const { items } = await this.foodItemService.getPage(
      { search: query },
      { page: 1, limit: FOOD_NUTRITION_MAX_RESULTS, sortOrder: SortOrder.Asc },
    );
    return {
      foods: items.map((food) => toFoodNutrition(food, quantityG ?? 100, this.nutritionService)),
    };
  }

  /** 400 (`rejected` for the model) naming the foods that do not exist. */
  public async calculateNutrition({
    items,
    servings,
  }: CalculateNutritionInput): Promise<CalculateNutritionResult> {
    const foods = await this.foodItemService.getByIds(items.map(({ foodId }) => foodId));
    const nutrition = this.nutritionService.calculateRecipe({
      id: '',
      servings: servings ?? 1,
      ingredients: items.map(({ foodId, quantityG }, index) => ({
        id: String(index),
        quantityG,
        isOptional: false,
        foodItem: foods.get(foodId)!,
      })),
    });
    return toNutritionCalculation(nutrition);
  }

  private nutritionOf(recipe: RecipeWithIngredients): RecipeNutrition {
    return this.nutritionService.calculateRecipe(recipe);
  }
}
