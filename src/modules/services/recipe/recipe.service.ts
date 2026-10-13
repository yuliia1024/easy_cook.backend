import { Injectable } from '@nestjs/common';
import { RecipeSource } from '../../../common/constants';
import {
  RecipeIngredientNotFoundException,
  RecipeNotFoundException,
  RecipeSourceConflictException,
} from '../../../common/exceptions';
import { Page, PageQuery } from '../../../common/types';
import { RecipeIngredientRepository } from '../../data-access/recipe-ingredient/recipe-ingredient.repository';
import {
  IngredientData,
  RecipeData,
  RecipeFilter,
  RecipeRepository,
  RecipeWithIngredients,
} from '../../data-access/recipe/recipe.repository';
import { FoodItemService } from '../food-item/food-item.service';

export type NewRecipeData = Omit<RecipeData, 'source'> & { source?: string };

@Injectable()
export class RecipeService {
  constructor(
    private readonly recipeRepository: RecipeRepository,
    private readonly recipeIngredientRepository: RecipeIngredientRepository,
    private readonly foodItemService: FoodItemService,
  ) {}

  public async getPage(
    filter: RecipeFilter,
    page: PageQuery,
  ): Promise<Page<RecipeWithIngredients>> {
    return this.recipeRepository.findPage({ ...filter, search: filter.search?.trim() }, page);
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

    await this.foodItemService.assertExist(ingredients.map((i) => i.foodItemId));
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

    if (ingredients) {
      await this.foodItemService.assertExist(ingredients.map((i) => i.foodItemId));
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
    await this.getById(recipeId);
    await this.foodItemService.assertExist([ingredient.foodItemId]);

    await this.recipeIngredientRepository.create(recipeId, ingredient);
    return this.getById(recipeId);
  }

  public async updateIngredient(
    recipeId: string,
    ingredientId: string,
    data: Partial<IngredientData>,
  ): Promise<RecipeWithIngredients> {
    await this.getIngredient(recipeId, ingredientId);
    if (data.foodItemId) {
      await this.foodItemService.assertExist([data.foodItemId]);
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
  private async getIngredient(recipeId: string, ingredientId: string): Promise<void> {
    await this.getById(recipeId);
    if (!(await this.recipeIngredientRepository.findOne(recipeId, ingredientId))) {
      throw new RecipeIngredientNotFoundException();
    }
  }

  private async assertSourceIsFree(source: string, sourceId?: string | null): Promise<void> {
    if (sourceId && (await this.recipeRepository.findBySource(source, sourceId))) {
      throw new RecipeSourceConflictException();
    }
  }
}
