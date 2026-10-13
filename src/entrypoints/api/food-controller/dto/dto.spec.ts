import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FoodSource, FoodState } from '../../../../common/constants';
import { CreateFoodItemDto, FoodItemQueryDto, UpdateFoodItemDto } from './food.dto';

async function errorsOf<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

describe('food DTOs', () => {
  const valid = {
    name: 'Buckwheat, dry',
    kcalPer100g: 343,
    proteinG: 13.3,
    fatG: 3.4,
    carbsG: 71.5,
    state: FoodState.Dried,
  };

  describe('CreateFoodItemDto', () => {
    it('accepts a food and trims the name', async () => {
      const dto = plainToInstance(CreateFoodItemDto, { ...valid, name: ' Buckwheat ' });

      expect(await validate(dto)).toHaveLength(0);
      expect(dto.name).toBe('Buckwheat');
    });

    it('needs only a name and a state', async () => {
      expect(await errorsOf(CreateFoodItemDto, { name: 'x', state: FoodState.Raw })).toEqual([]);
      expect(await errorsOf(CreateFoodItemDto, {})).toEqual(['name', 'state']);
    });

    it('accepts null for unknown values', async () => {
      expect(
        await errorsOf(CreateFoodItemDto, {
          ...valid,
          kcalPer100g: null,
          nameEn: null,
          sourceId: null,
        }),
      ).toEqual([]);
    });

    it.each([
      ['negative kcal', { kcalPer100g: -1 }, 'kcalPer100g'],
      ['impossible kcal', { kcalPer100g: 901 }, 'kcalPer100g'],
      ['negative protein', { proteinG: -0.1 }, 'proteinG'],
      ['fat over 100 g', { fatG: 100.1 }, 'fatG'],
      ['carbs as a string', { carbsG: '70' }, 'carbsG'],
      ['an unknown state', { state: 'grilled' }, 'state'],
      ['an unknown source', { source: 'wiki' }, 'source'],
      ['an empty source id', { sourceId: '  ' }, 'sourceId'],
      ['a blank name', { name: ' ' }, 'name'],
    ])('rejects %s', async (_case, patch, property) => {
      expect(await errorsOf(CreateFoodItemDto, { ...valid, ...patch })).toEqual([property]);
    });

    it('accepts every source', async () => {
      for (const source of Object.values(FoodSource)) {
        expect(await errorsOf(CreateFoodItemDto, { ...valid, source })).toEqual([]);
      }
    });
  });

  it('UpdateFoodItemDto validates only the given fields', async () => {
    expect(await errorsOf(UpdateFoodItemDto, {})).toEqual([]);
    expect(await errorsOf(UpdateFoodItemDto, { fatG: null })).toEqual([]);
    expect(await errorsOf(UpdateFoodItemDto, { fatG: -5 })).toEqual(['fatG']);
  });

  describe('FoodItemQueryDto', () => {
    it('accepts filters with paging', async () => {
      const dto = plainToInstance(FoodItemQueryDto, {
        search: ' rice ',
        state: 'boiled',
        source: 'seed',
        page: '2',
      });

      expect(await validate(dto)).toHaveLength(0);
      expect(dto).toMatchObject({ search: 'rice', page: 2, limit: 20 });
    });

    it('rejects an unknown state filter', async () => {
      expect(await errorsOf(FoodItemQueryDto, { state: 'grilled' })).toEqual(['state']);
    });
  });
});
