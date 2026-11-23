import { Injectable } from '@nestjs/common';
import { FoodItem } from '../../../generated/prisma/client';
import {
  FoodItemNotFoundException,
  FoodItemsNotFoundBadRequestException,
} from '../../../common/exceptions';
import { Page, PageQuery } from '../../../common/types';
import {
  FoodItemFilter,
  FoodItemRepository,
  FoodItemWithTranslations,
} from '../../data-access/food-item/food-item.repository';

/** The food catalog, read only: foods come from the seed and the dataset imports. */
@Injectable()
export class FoodItemService {
  constructor(private readonly foodItemRepository: FoodItemRepository) {}

  public async getPage(
    filter: FoodItemFilter,
    page: PageQuery,
  ): Promise<Page<FoodItemWithTranslations>> {
    return this.foodItemRepository.findPage({ ...filter, search: filter.search?.trim() }, page);
  }

  public async getById(id: string): Promise<FoodItemWithTranslations> {
    const food = await this.foodItemRepository.findById(id);
    if (!food) {
      throw new FoodItemNotFoundException();
    }
    return food;
  }

  /** The foods by id; throws listing every id of `ids` that does not exist. */
  public async getByIds(ids: string[]): Promise<Map<string, FoodItem>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      return new Map();
    }

    const foods = new Map(
      (await this.foodItemRepository.findByIds(unique)).map((food) => [food.id, food]),
    );
    const missing = unique.filter((id) => !foods.has(id));
    if (missing.length > 0) {
      throw new FoodItemsNotFoundBadRequestException(missing);
    }
    return foods;
  }
}
