import { Injectable } from '@nestjs/common';
import { FoodItem } from '../../../generated/prisma/client';
import { FoodSource } from '../../../common/constants';
import {
  FoodItemNotFoundException,
  FoodItemSourceConflictException,
  FoodItemsNotFoundBadRequestException,
  MacrosExceedWeightBadRequestException,
} from '../../../common/exceptions';
import { Page, PageQuery } from '../../../common/types';
import { toNumber } from '../../../common/utils';
import {
  FoodItemData,
  FoodItemFilter,
  FoodItemRepository,
} from '../../data-access/food-item/food-item.repository';

export type NewFoodItemData = Omit<FoodItemData, 'source'> & { source?: string };

@Injectable()
export class FoodItemService {
  constructor(private readonly foodItemRepository: FoodItemRepository) {}

  public async getPage(filter: FoodItemFilter, page: PageQuery): Promise<Page<FoodItem>> {
    return this.foodItemRepository.findPage({ ...filter, search: filter.search?.trim() }, page);
  }

  public async getById(id: string): Promise<FoodItem> {
    const food = await this.foodItemRepository.findById(id);
    if (!food) {
      throw new FoodItemNotFoundException();
    }
    return food;
  }

  /** Throws listing every id of `ids` that does not exist. */
  public async assertExist(ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      return;
    }

    const existing = new Set(await this.foodItemRepository.findExistingIds(unique));
    const missing = unique.filter((id) => !existing.has(id));
    if (missing.length > 0) {
      throw new FoodItemsNotFoundBadRequestException(missing);
    }
  }

  public async create(data: NewFoodItemData): Promise<FoodItem> {
    const food: FoodItemData = { ...data, source: data.source ?? FoodSource.Manual };

    this.assertMacrosFit(food);
    await this.assertSourceIsFree(food.source, food.sourceId);

    return this.foodItemRepository.create(food);
  }

  public async update(id: string, data: Partial<FoodItemData>): Promise<FoodItem> {
    const current = await this.getById(id);

    this.assertMacrosFit({
      proteinG: toNumber(current.proteinG),
      fatG: toNumber(current.fatG),
      carbsG: toNumber(current.carbsG),
      ...data,
    });

    const source = data.source ?? current.source;
    const sourceId = data.sourceId === undefined ? current.sourceId : data.sourceId;
    if (source !== current.source || sourceId !== current.sourceId) {
      await this.assertSourceIsFree(source, sourceId);
    }

    return this.foodItemRepository.update(id, data);
  }

  /** Grams of macros in 100 g of food cannot exceed 100 g (unknown values count as 0). */
  private assertMacrosFit({ proteinG, fatG, carbsG }: Partial<FoodItemData>): void {
    if ((proteinG ?? 0) + (fatG ?? 0) + (carbsG ?? 0) > 100) {
      throw new MacrosExceedWeightBadRequestException();
    }
  }

  private async assertSourceIsFree(source: string, sourceId?: string | null): Promise<void> {
    if (sourceId && (await this.foodItemRepository.findBySource(source, sourceId))) {
      throw new FoodItemSourceConflictException();
    }
  }
}
