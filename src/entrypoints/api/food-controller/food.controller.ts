import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FoodItemResponseDto } from '../dto/food-item.response.dto';
import { PageResponseDto } from '../dto/pagination.dto';
import { CreateFoodItemDto, FoodItemQueryDto, UpdateFoodItemDto } from './dto/food.dto';
import { FoodControllerService } from './food-controller.service';

@ApiTags('Foods')
@Controller('foods')
export class FoodController {
  constructor(private readonly foodControllerService: FoodControllerService) {}

  /** Paged, sorted by name. `search` matches `name` and `nameEn`. */
  @Get()
  async getPage(@Query() query: FoodItemQueryDto): Promise<PageResponseDto<FoodItemResponseDto>> {
    return this.foodControllerService.getPage(query);
  }

  @Get(':id')
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<FoodItemResponseDto> {
    return this.foodControllerService.getById(id);
  }

  /** 409 when `source` + `sourceId` is taken. */
  @Post()
  async create(@Body() dto: CreateFoodItemDto): Promise<FoodItemResponseDto> {
    return this.foodControllerService.create(dto);
  }

  /** `null` clears a nutrient value (= unknown). */
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFoodItemDto,
  ): Promise<FoodItemResponseDto> {
    return this.foodControllerService.update(id, dto);
  }
}
