import { Injectable } from '@nestjs/common';
import { RecipeWithIngredients } from '../../../modules/data-access/recipe/recipe.repository';
import {
  NutritionService,
  RecipeNutrition,
} from '../../../modules/services/nutrition/nutrition.service';
import { RecipeService } from '../../../modules/services/recipe/recipe.service';
import { PageResponseDto, PaginationQueryDto } from '../dto/pagination.dto';
import {
  CreateRecipeDto,
  RecipeIngredientDto,
  RecipeNutritionQueryDto,
  RecipeQueryDto,
  UpdateRecipeDto,
  UpdateRecipeIngredientDto,
} from './dto/recipe.dto';
import { RecipeResponseDto } from './dto/recipe.response.dto';

@Injectable()
export class RecipeControllerService {
  constructor(
    private readonly recipeService: RecipeService,
    private readonly nutritionService: NutritionService,
  ) {}

  public async getPage({
    search,
    mealType,
    dietType,
    ...paging
  }: RecipeQueryDto): Promise<PageResponseDto<RecipeResponseDto>> {
    const query = PaginationQueryDto.toPageQuery(paging);
    const page = await this.recipeService.getPage({ search, mealType, dietTypes: dietType }, query);
    return PageResponseDto.from(page, query, (recipe) => this.toResponse(recipe));
  }

  public async getById(id: string): Promise<RecipeResponseDto> {
    return this.toResponse(await this.recipeService.getById(id));
  }

  public async getNutrition(id: string, query: RecipeNutritionQueryDto): Promise<RecipeNutrition> {
    const recipe = await this.recipeService.getById(id);
    return this.nutritionService.calculateRecipe(recipe, {
      includeOptional: query.includeOptional ?? false,
    });
  }

  public async create({ ingredients, ...data }: CreateRecipeDto): Promise<RecipeResponseDto> {
    return this.toResponse(await this.recipeService.create(data, ingredients));
  }

  public async update(
    id: string,
    { ingredients, ...data }: UpdateRecipeDto,
  ): Promise<RecipeResponseDto> {
    return this.toResponse(await this.recipeService.update(id, data, ingredients));
  }

  public async delete(id: string): Promise<void> {
    await this.recipeService.delete(id);
  }

  public async addIngredient(id: string, dto: RecipeIngredientDto): Promise<RecipeResponseDto> {
    return this.toResponse(await this.recipeService.addIngredient(id, dto));
  }

  public async updateIngredient(
    id: string,
    ingredientId: string,
    dto: UpdateRecipeIngredientDto,
  ): Promise<RecipeResponseDto> {
    return this.toResponse(await this.recipeService.updateIngredient(id, ingredientId, dto));
  }

  public async removeIngredient(id: string, ingredientId: string): Promise<RecipeResponseDto> {
    return this.toResponse(await this.recipeService.removeIngredient(id, ingredientId));
  }

  private toResponse(recipe: RecipeWithIngredients): RecipeResponseDto {
    return RecipeResponseDto.from(recipe, this.nutritionService.calculateRecipe(recipe));
  }
}
