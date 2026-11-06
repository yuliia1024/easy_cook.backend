import { Injectable } from '@nestjs/common';
import {
  ChatToolName,
  FOOD_NUTRITION_MAX_RESULTS,
  SEARCH_RECIPES_DEFAULT_RESULTS,
  SEARCH_RECIPES_SCAN_LIMIT,
  SortOrder,
} from '../../../common/constants';
import {
  CalculateNutritionInput,
  CalculateNutritionInputSchema,
  GetFoodNutritionInput,
  GetFoodNutritionInputSchema,
  GetRecipeDetailsInput,
  GetRecipeDetailsInputSchema,
  PlanMenuInputSchema,
  ReviseMenuInputSchema,
  SearchRecipesInput,
  SearchRecipesInputSchema,
} from '../../../common/contracts';
import {
  CalculateNutritionResult,
  GetFoodNutritionResult,
  PreferenceRules,
  ProfileContext,
  RecipeDetailsResult,
  SearchRecipesResult,
} from '../../../common/types';
import { RecipeWithIngredients } from '../../data-access/recipe/recipe.repository';
import { FoodItemService } from '../food-item/food-item.service';
import { dietTagsSatisfying } from '../menu/menu-rules';
import { NutritionService, RecipeNutrition } from '../nutrition/nutrition.service';
import { RecipeService } from '../recipe/recipe.service';
import { ChatTool, readTool, serviceCallTool } from './chat-tool-registry';
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
 * request, so the model decides when to plan but never what is checked or saved.
 */
@Injectable()
export class ChatToolsService {
  constructor(
    private readonly recipeService: RecipeService,
    private readonly foodItemService: FoodItemService,
    private readonly nutritionService: NutritionService,
  ) {}

  /** Every tool, the recipes marked against the rules of `profile`. */
  public tools(profile: ProfileContext | null): ChatTool[] {
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
    ];
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
