import { Injectable } from '@nestjs/common';
import { FoodItem } from '../../../generated/prisma/client';
import { FOOD_KCAL_TOLERANCE, FoodSource, KCAL_PER_GRAM } from '../../../common/constants';
import {
  FoodItemNotFoundException,
  FoodItemSourceConflictException,
  FoodItemsNotFoundBadRequestException,
  FoodKcalMismatchBadRequestException,
  FoodStateInUseConflictException,
  MacrosExceedWeightBadRequestException,
} from '../../../common/exceptions';
import { Page, PageQuery } from '../../../common/types';
import { toNumber } from '../../../common/utils';
import {
  FoodItemData,
  FoodItemFilter,
  FoodItemRepository,
  FoodItemWithTranslations,
} from '../../data-access/food-item/food-item.repository';

export type NewFoodItemData = Omit<FoodItemData, 'source'> & { source?: string };

type NutrientValues = Pick<FoodItemData, 'kcalPer100g' | 'proteinG' | 'fatG' | 'carbsG'>;
const NUTRIENTS: Array<keyof NutrientValues> = ['kcalPer100g', 'proteinG', 'fatG', 'carbsG'];

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

  public async create(data: NewFoodItemData): Promise<FoodItemWithTranslations> {
    const food: FoodItemData = { ...data, source: data.source ?? FoodSource.Manual };

    this.assertMacrosFit(food);
    this.assertKcalMatchesMacros(food);
    await this.assertSourceIsFree(food.source, food.sourceId);

    return this.foodItemRepository.create(food);
  }

  /**
   * Nutrients are checked merged with the stored values. The kcal check runs only when a nutrient
   * value changes, so an older row that does not pass it can still be renamed.
   */
  public async update(id: string, data: Partial<FoodItemData>): Promise<FoodItemWithTranslations> {
    const current = await this.getById(id);
    const stored: NutrientValues = {
      kcalPer100g: toNumber(current.kcalPer100g),
      proteinG: toNumber(current.proteinG),
      fatG: toNumber(current.fatG),
      carbsG: toNumber(current.carbsG),
    };
    const nutrients: NutrientValues = { ...stored, ...data };

    this.assertMacrosFit(nutrients);
    // Compared by value: the web form always sends every nutrient.
    if (NUTRIENTS.some((nutrient) => nutrients[nutrient] !== stored[nutrient])) {
      this.assertKcalMatchesMacros(nutrients);
    }

    // The recipes weigh the food in its state: 100 g dry and 100 g boiled are not the same.
    if (
      data.state !== undefined &&
      data.state !== current.state &&
      (await this.foodItemRepository.isUsedInRecipes(id))
    ) {
      throw new FoodStateInUseConflictException();
    }

    const source = data.source ?? current.source;
    const sourceId = data.sourceId === undefined ? current.sourceId : data.sourceId;
    if (source !== current.source || sourceId !== current.sourceId) {
      await this.assertSourceIsFree(source, sourceId);
    }

    return this.foodItemRepository.update(id, data);
  }

  /** Grams of macros in 100 g of food cannot exceed 100 g (unknown values count as 0). */
  private assertMacrosFit({ proteinG, fatG, carbsG }: NutrientValues): void {
    if ((proteinG ?? 0) + (fatG ?? 0) + (carbsG ?? 0) > 100) {
      throw new MacrosExceedWeightBadRequestException();
    }
  }

  /**
   * With every value known, the kcal must be close to 4/9/4 kcal per gram of protein/fat/carbs.
   * The tolerance leaves room for fibre and polyols; alcohol is not modelled.
   */
  private assertKcalMatchesMacros({ kcalPer100g, proteinG, fatG, carbsG }: NutrientValues): void {
    if (kcalPer100g == null || proteinG == null || fatG == null || carbsG == null) {
      return;
    }

    const estimate =
      proteinG * KCAL_PER_GRAM.protein + fatG * KCAL_PER_GRAM.fat + carbsG * KCAL_PER_GRAM.carbs;
    const tolerance = Math.max(
      FOOD_KCAL_TOLERANCE.absolute,
      estimate * FOOD_KCAL_TOLERANCE.relative,
    );
    if (Math.abs(kcalPer100g - estimate) > tolerance) {
      throw new FoodKcalMismatchBadRequestException(kcalPer100g, estimate);
    }
  }

  private async assertSourceIsFree(source: string, sourceId?: string | null): Promise<void> {
    if (sourceId && (await this.foodItemRepository.findBySource(source, sourceId))) {
      throw new FoodItemSourceConflictException();
    }
  }
}
