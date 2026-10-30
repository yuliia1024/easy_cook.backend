import { Injectable } from '@nestjs/common';
import {
  MAX_RECIPE_INGREDIENTS,
  MAX_SERVING_KCAL,
  MAX_SERVING_WEIGHT_G,
  RecipeSource,
} from '../../../common/constants';
import {
  RecipeIngredientNotFoundException,
  RecipeNotFoundException,
  RecipeSourceConflictException,
  ServingTooHeavyBadRequestException,
  ServingTooManyKcalBadRequestException,
  TooManyIngredientsBadRequestException,
} from '../../../common/exceptions';
import { Page, PageQuery, PreferenceRules } from '../../../common/types';
import { toNumber } from '../../../common/utils';
import { RecipeIngredientRepository } from '../../data-access/recipe-ingredient/recipe-ingredient.repository';
import {
  IngredientData,
  RecipeData,
  RecipeFilter,
  RecipeRepository,
  RecipeWithIngredients,
} from '../../data-access/recipe/recipe.repository';
import { FoodItemService } from '../food-item/food-item.service';
import { allergenMatching, dietTagsSatisfying, isForbiddenFood } from '../menu/menu-rules';
import { NutritionIngredientInput, NutritionService } from '../nutrition/nutrition.service';

export type NewRecipeData = Omit<RecipeData, 'source'> & { source?: string };

@Injectable()
export class RecipeService {
  constructor(
    private readonly recipeRepository: RecipeRepository,
    private readonly recipeIngredientRepository: RecipeIngredientRepository,
    private readonly foodItemService: FoodItemService,
    private readonly nutritionService: NutritionService,
  ) {}

  public async getPage(
    filter: RecipeFilter,
    page: PageQuery,
  ): Promise<Page<RecipeWithIngredients>> {
    return this.recipeRepository.findPage({ ...filter, search: filter.search?.trim() }, page);
  }

  /**
   * Recipes that satisfy every diet of the profile (a vegan one fits a vegetarian) and no allergen or excluded ingredient (optional
   * ones too), by food name and by the allergens of the recipe. Disliked foods stay: they only warn.
   */
  public async getAllowed(rules: PreferenceRules): Promise<RecipeWithIngredients[]> {
    const recipes = await this.recipeRepository.findAll({
      dietTypeGroups: rules.diets.map((diet) => [...dietTagsSatisfying(diet)]),
    });
    return recipes.filter(
      (recipe) =>
        !recipe.ingredients.some(({ foodItem }) =>
          isForbiddenFood(foodItem.name, foodItem.nameEn, rules),
        ) && !rules.allergies.some((allergy) => allergenMatching(recipe.allergens, allergy)),
    );
  }

  public async getById(id: string): Promise<RecipeWithIngredients> {
    const recipe = await this.recipeRepository.findById(id);
    if (!recipe) {
      throw new RecipeNotFoundException();
    }
    return recipe;
  }

  public async create(
    data: NewRecipeData,
    ingredients: IngredientData[],
  ): Promise<RecipeWithIngredients> {
    const recipe: RecipeData = { ...data, source: data.source ?? RecipeSource.Manual };

    this.assertServingFits(recipe.servings, await this.withFoods(ingredients));
    await this.assertSourceIsFree(recipe.source, recipe.sourceId);

    return this.recipeRepository.create(recipe, ingredients);
  }

  /** `ingredients`, when given, replace the whole list. */
  public async update(
    id: string,
    data: Partial<RecipeData>,
    ingredients?: IngredientData[],
  ): Promise<RecipeWithIngredients> {
    const current = await this.getById(id);

    if (ingredients || data.servings !== undefined) {
      this.assertServingFits(
        data.servings ?? current.servings,
        ingredients ? await this.withFoods(ingredients) : current.ingredients,
      );
    }

    const source = data.source ?? current.source;
    const sourceId = data.sourceId === undefined ? current.sourceId : data.sourceId;
    if (source !== current.source || sourceId !== current.sourceId) {
      await this.assertSourceIsFree(source, sourceId);
    }

    return this.recipeRepository.update(id, data, ingredients);
  }

  public async delete(id: string): Promise<void> {
    await this.getById(id);
    await this.recipeRepository.delete(id);
  }

  public async addIngredient(
    recipeId: string,
    ingredient: IngredientData,
  ): Promise<RecipeWithIngredients> {
    const recipe = await this.getById(recipeId);
    if (recipe.ingredients.length >= MAX_RECIPE_INGREDIENTS) {
      throw new TooManyIngredientsBadRequestException(MAX_RECIPE_INGREDIENTS);
    }
    this.assertServingFits(recipe.servings, [
      ...recipe.ingredients,
      ...(await this.withFoods([ingredient])),
    ]);

    await this.recipeIngredientRepository.create(recipeId, ingredient);
    return this.getById(recipeId);
  }

  public async updateIngredient(
    recipeId: string,
    ingredientId: string,
    data: Partial<IngredientData>,
  ): Promise<RecipeWithIngredients> {
    const recipe = await this.getIngredient(recipeId, ingredientId);

    if (data.foodItemId !== undefined || data.quantityG !== undefined) {
      const [food] = data.foodItemId
        ? (await this.foodItemService.getByIds([data.foodItemId])).values()
        : [];
      this.assertServingFits(
        recipe.servings,
        recipe.ingredients.map((ingredient) =>
          ingredient.id === ingredientId
            ? {
                ...ingredient,
                quantityG: data.quantityG ?? ingredient.quantityG,
                foodItem: food ?? ingredient.foodItem,
              }
            : ingredient,
        ),
      );
    }

    await this.recipeIngredientRepository.update(ingredientId, data);
    return this.getById(recipeId);
  }

  public async removeIngredient(
    recipeId: string,
    ingredientId: string,
  ): Promise<RecipeWithIngredients> {
    await this.getIngredient(recipeId, ingredientId);

    await this.recipeIngredientRepository.delete(ingredientId);
    return this.getById(recipeId);
  }

  /** 404 for an unknown recipe first, then for an ingredient of another recipe. */
  private async getIngredient(
    recipeId: string,
    ingredientId: string,
  ): Promise<RecipeWithIngredients> {
    const recipe = await this.getById(recipeId);
    if (!(await this.recipeIngredientRepository.findOne(recipeId, ingredientId))) {
      throw new RecipeIngredientNotFoundException();
    }
    return recipe;
  }

  /** The ingredients with their foods; 400 listing the foods that do not exist. */
  private async withFoods(ingredients: IngredientData[]): Promise<NutritionIngredientInput[]> {
    const foods = await this.foodItemService.getByIds(ingredients.map((i) => i.foodItemId));
    return ingredients.map((ingredient, index) => ({
      id: String(index),
      quantityG: ingredient.quantityG,
      isOptional: ingredient.isOptional ?? false,
      foodItem: foods.get(ingredient.foodItemId)!,
    }));
  }

  /** One serving, optional ingredients included, must stay a plausible amount of food. */
  private assertServingFits(servings: number, ingredients: NutritionIngredientInput[]): void {
    const weightG = ingredients.reduce((sum, i) => sum + toNumber(i.quantityG), 0) / servings;
    if (weightG > MAX_SERVING_WEIGHT_G) {
      throw new ServingTooHeavyBadRequestException(weightG, MAX_SERVING_WEIGHT_G);
    }

    const { kcal } = this.nutritionService.calculateRecipe(
      { id: '', servings, ingredients },
      { includeOptional: true },
    ).perServing;
    if (kcal > MAX_SERVING_KCAL) {
      throw new ServingTooManyKcalBadRequestException(kcal, MAX_SERVING_KCAL);
    }
  }

  private async assertSourceIsFree(source: string, sourceId?: string | null): Promise<void> {
    if (sourceId && (await this.recipeRepository.findBySource(source, sourceId))) {
      throw new RecipeSourceConflictException();
    }
  }
}
