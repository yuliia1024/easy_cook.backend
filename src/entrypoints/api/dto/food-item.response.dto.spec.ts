import { buildFoodItem } from '../../../test/fixtures';
import { FoodItemResponseDto } from './food-item.response.dto';

describe('FoodItemResponseDto', () => {
  it('turns decimals into numbers', () => {
    const food = buildFoodItem();

    expect(FoodItemResponseDto.from(food)).toEqual({
      id: food.id,
      name: 'Рис білий варений',
      nameEn: 'Rice, white, boiled',
      kcalPer100g: 130,
      proteinG: 2.7,
      fatG: 0.3,
      carbsG: 28.2,
      state: 'boiled',
      source: 'seed',
      sourceId: 'rice-white-boiled',
      createdAt: food.createdAt,
      updatedAt: food.updatedAt,
    });
  });

  it('keeps unknown values null', () => {
    expect(FoodItemResponseDto.from(buildFoodItem({ fatG: null })).fatG).toBeNull();
  });
});
