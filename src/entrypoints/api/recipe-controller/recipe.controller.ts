import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RecipeNutrition } from '../../../modules/services/nutrition/nutrition.service';
import { PageResponseDto } from '../dto/pagination.dto';
import { RecipeNutritionQueryDto, RecipeQueryDto } from './dto/recipe.dto';
import { RecipeResponseDto } from './dto/recipe.response.dto';
import { RecipeControllerService } from './recipe-controller.service';

/** The recipe catalog, read only (seeded). */
@ApiTags('Recipes')
@Controller('recipes')
export class RecipeController {
  constructor(private readonly recipeControllerService: RecipeControllerService) {}

  /** Paged, sorted by name (`sortOrder`, default `asc`). Filters combine with AND. */
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
}
