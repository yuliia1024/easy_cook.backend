import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FoodItemResponseDto } from '../dto/food-item.response.dto';
import { PageResponseDto } from '../dto/pagination.dto';
import { FoodItemQueryDto } from './dto/food.dto';
import { FoodControllerService } from './food-controller.service';

/** The food catalog, read only (seeded). */
@ApiTags('Foods')
@Controller('foods')
export class FoodController {
  constructor(private readonly foodControllerService: FoodControllerService) {}

  /** Paged, sorted by name (`sortOrder`, default `asc`). `search` matches `name` and `nameEn`. */
  @Get()
  async getPage(@Query() query: FoodItemQueryDto): Promise<PageResponseDto<FoodItemResponseDto>> {
    return this.foodControllerService.getPage(query);
  }

  @Get(':id')
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<FoodItemResponseDto> {
    return this.foodControllerService.getById(id);
  }
}
