import { FoodItem, FoodItemTranslation } from '../../../generated/prisma/client';
import { FoodSource, FoodState, Locale } from '../../../common/constants';
import { toNumber } from '../../../common/utils';

export class FoodItemTranslationResponseDto {
  name: string;
}

export class FoodItemResponseDto {
  id: string;
  name: string;
  nameEn: string | null;
  /** Per 100 g of the food in `state`. Null = unknown. */
  kcalPer100g: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  state: FoodState;
  source: FoodSource;
  sourceId: string | null;
  /** The name in other languages, by `Locale`; a missing one is not translated. */
  translations: Partial<Record<Locale, FoodItemTranslationResponseDto>>;
  createdAt: Date;
  updatedAt: Date;

  static from(food: FoodItem & { translations: FoodItemTranslation[] }): FoodItemResponseDto {
    return {
      id: food.id,
      name: food.name,
      nameEn: food.nameEn,
      kcalPer100g: toNumber(food.kcalPer100g),
      proteinG: toNumber(food.proteinG),
      fatG: toNumber(food.fatG),
      carbsG: toNumber(food.carbsG),
      state: food.state as FoodState,
      source: food.source as FoodSource,
      sourceId: food.sourceId,
      translations: Object.fromEntries(
        food.translations.map(({ locale, name }) => [locale, { name }]),
      ),
      createdAt: food.createdAt,
      updatedAt: food.updatedAt,
    };
  }
}
