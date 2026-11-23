import { buildFoodItem, FOOD_ID } from '../../../test/fixtures';
import { FoodItemResponseDto } from './food-item.response.dto';

describe('FoodItemResponseDto', () => {
  it('turns decimals into numbers', () => {
    const food = buildFoodItem();

    expect(FoodItemResponseDto.from(food)).toEqual({
      id: food.id,
      name: 'White rice, boiled',
      nameEn: 'Rice, white, boiled',
      kcalPer100g: 130,
      proteinG: 2.7,
      fatG: 0.3,
      carbsG: 28.2,
      state: 'boiled',
      source: 'seed',
      sourceId: 'rice-white-boiled',
      translations: {},
      createdAt: food.createdAt,
      updatedAt: food.updatedAt,
    });
  });

  it('maps the translations by locale', () => {
    const food = buildFoodItem({
      translations: [
        { foodItemId: FOOD_ID, locale: 'uk', name: 'Рис білий, варений', updatedAt: new Date() },
      ],
    });

    expect(FoodItemResponseDto.from(food).translations).toEqual({
      uk: { name: 'Рис білий, варений' },
    });
  });

  it('keeps unknown values null', () => {
    expect(FoodItemResponseDto.from(buildFoodItem({ fatG: null })).fatG).toBeNull();
  });
});
