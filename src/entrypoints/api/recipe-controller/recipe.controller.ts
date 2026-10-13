import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RecipeNutrition } from '../../../modules/services/nutrition/nutrition.service';
import { PageResponseDto } from '../dto/pagination.dto';
import {
  CreateRecipeDto,
  RecipeIngredientDto,
  RecipeNutritionQueryDto,
  RecipeQueryDto,
  UpdateRecipeDto,
  UpdateRecipeIngredientDto,
} from './dto/recipe.dto';
import { RecipeResponseDto } from './dto/recipe.response.dto';
import { RecipeControllerService } from './recipe-controller.service';

@ApiTags('Recipes')
@Controller('recipes')
export class RecipeController {
  constructor(private readonly recipeControllerService: RecipeControllerService) {}

  /** Paged, sorted by name. Filters combine with AND. */
  @Get()
  async getPage(@Query() query: RecipeQueryDto): Promise<PageResponseDto<RecipeResponseDto>> {
    return this.recipeControllerService.getPage(query);
  }

  @Get(':id')
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<RecipeResponseDto> {
    return this.recipeControllerService.getById(id);
  }

  /**
   * Calories and macros per ingredient, for the whole recipe and per serving. The totals are the
   * sum of the ingredients, not a measurement of the cooked dish.
   */
  @Get(':id/nutrition')
  async getNutrition(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: RecipeNutritionQueryDto,
  ): Promise<RecipeNutrition> {
    return this.recipeControllerService.getNutrition(id, query);
  }

  /** 400 when an ingredient points to a food that does not exist. */
  @Post()
  async create(@Body() dto: CreateRecipeDto): Promise<RecipeResponseDto> {
    return this.recipeControllerService.create(dto);
  }

  /** `ingredients`, when given, replace the whole list. */
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecipeDto,
  ): Promise<RecipeResponseDto> {
    return this.recipeControllerService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.recipeControllerService.delete(id);
  }

  /** Appends an ingredient; returns the recipe. */
  @Post(':id/ingredients')
  async addIngredient(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecipeIngredientDto,
  ): Promise<RecipeResponseDto> {
    return this.recipeControllerService.addIngredient(id, dto);
  }

  @Patch(':id/ingredients/:ingredientId')
  async updateIngredient(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ingredientId', ParseUUIDPipe) ingredientId: string,
    @Body() dto: UpdateRecipeIngredientDto,
  ): Promise<RecipeResponseDto> {
    return this.recipeControllerService.updateIngredient(id, ingredientId, dto);
  }

  @Delete(':id/ingredients/:ingredientId')
  async removeIngredient(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ingredientId', ParseUUIDPipe) ingredientId: string,
  ): Promise<RecipeResponseDto> {
    return this.recipeControllerService.removeIngredient(id, ingredientId);
  }
}
