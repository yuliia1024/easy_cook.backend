import { Injectable } from '@nestjs/common';
import { FoodItemService } from '../../../modules/services/food-item/food-item.service';
import { FoodItemResponseDto } from '../dto/food-item.response.dto';
import { PageResponseDto, PaginationQueryDto } from '../dto/pagination.dto';
import { CreateFoodItemDto, FoodItemQueryDto, UpdateFoodItemDto } from './dto/food.dto';

@Injectable()
export class FoodControllerService {
  constructor(private readonly foodItemService: FoodItemService) {}

  public async getPage({
    search,
    state,
    source,
    ...paging
  }: FoodItemQueryDto): Promise<PageResponseDto<FoodItemResponseDto>> {
    const query = PaginationQueryDto.toPageQuery(paging);
    const page = await this.foodItemService.getPage({ search, state, source }, query);
    return PageResponseDto.from(page, query, FoodItemResponseDto.from);
  }

  public async getById(id: string): Promise<FoodItemResponseDto> {
    return FoodItemResponseDto.from(await this.foodItemService.getById(id));
  }

  public async create(dto: CreateFoodItemDto): Promise<FoodItemResponseDto> {
    return FoodItemResponseDto.from(await this.foodItemService.create(dto));
  }

  public async update(id: string, dto: UpdateFoodItemDto): Promise<FoodItemResponseDto> {
    return FoodItemResponseDto.from(await this.foodItemService.update(id, dto));
  }
}
