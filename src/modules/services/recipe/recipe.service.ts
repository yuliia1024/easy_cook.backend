import { Injectable } from '@nestjs/common';
import { RecipeNotFoundException } from '../../../common/exceptions';
import { Page, PageQuery, PreferenceRules } from '../../../common/types';
import {
  RecipeFilter,
  RecipeRepository,
  RecipeWithIngredients,
} from '../../data-access/recipe/recipe.repository';
import { dietTagsSatisfying, isRecipeAllowed } from '../menu/menu-rules';

/** The recipe catalog, read only: recipes come from the seed. */
@Injectable()
export class RecipeService {
  constructor(private readonly recipeRepository: RecipeRepository) {}

  public async getPage(
    filter: RecipeFilter,
    page: PageQuery,
  ): Promise<Page<RecipeWithIngredients>> {
    return this.recipeRepository.findPage({ ...filter, search: filter.search?.trim() }, page);
  }

  /**
   * Recipes the rules allow (`isRecipeAllowed`): the diets are searched in the database, the
   * allergies and excluded ingredients checked here. Disliked foods stay: they only warn.
   */
  public async getAllowed(rules: PreferenceRules): Promise<RecipeWithIngredients[]> {
    const recipes = await this.recipeRepository.findAll({
      dietTypeGroups: rules.diets.map((diet) => [...dietTagsSatisfying(diet)]),
    });
    return recipes.filter((recipe) => isRecipeAllowed(recipe, rules));
  }

  /** Every recipe, whatever the rules: to tell which rule leaves too few of them. */
  public async getAll(): Promise<RecipeWithIngredients[]> {
    return this.recipeRepository.findAll({});
  }

  public async getById(id: string): Promise<RecipeWithIngredients> {
    const recipe = await this.recipeRepository.findById(id);
    if (!recipe) {
      throw new RecipeNotFoundException();
    }
    return recipe;
  }
}
