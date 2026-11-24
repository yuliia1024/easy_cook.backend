import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FoodItemQueryDto } from './food.dto';

async function errorsOf<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

describe('food DTOs', () => {
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
