import { FoodState, SortOrder } from '../../../common/constants';
import {
  FoodItemNotFoundException,
  FoodItemsNotFoundBadRequestException,
} from '../../../common/exceptions';
import { createMock } from '../../../test/create-mock';
import { buildFoodItem, FOOD_ID } from '../../../test/fixtures';
import { FoodItemRepository } from '../../data-access/food-item/food-item.repository';
import { FoodItemService } from './food-item.service';

describe('FoodItemService', () => {
  let repository: jest.Mocked<FoodItemRepository>;
  let service: FoodItemService;

  beforeEach(() => {
    repository = createMock<FoodItemRepository>();
    service = new FoodItemService(repository);
  });

  it('getPage trims the search', async () => {
    const page = { page: 1, limit: 20, sortOrder: SortOrder.Asc };

    await service.getPage({ search: '  rice ', state: FoodState.Raw }, page);

    expect(repository.findPage).toHaveBeenCalledWith(
      { search: 'rice', state: FoodState.Raw },
      page,
    );
  });

  describe('getById', () => {
    it('returns the food', async () => {
      const food = buildFoodItem();
      repository.findById.mockResolvedValue(food);

      await expect(service.getById(FOOD_ID)).resolves.toBe(food);
    });

    it('fails for an unknown id', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.getById(FOOD_ID)).rejects.toBeInstanceOf(FoodItemNotFoundException);
    });
  });

  describe('getByIds', () => {
    it('returns the foods by id (duplicates allowed)', async () => {
      const a = buildFoodItem({ id: 'a' });
      const b = buildFoodItem({ id: 'b' });
      repository.findByIds.mockResolvedValue([a, b]);

      const foods = await service.getByIds(['a', 'b', 'a']);

      expect([...foods.entries()]).toEqual([
        ['a', a],
        ['b', b],
      ]);
      expect(repository.findByIds).toHaveBeenCalledWith(['a', 'b']);
    });

    it('lists the missing ids', async () => {
      repository.findByIds.mockResolvedValue([buildFoodItem({ id: 'a' })]);

      await expect(service.getByIds(['a', 'b', 'c'])).rejects.toThrow(
        new FoodItemsNotFoundBadRequestException(['b', 'c']),
      );
    });

    it('does not query for an empty list', async () => {
      await expect(service.getByIds([])).resolves.toEqual(new Map());

      expect(repository.findByIds).not.toHaveBeenCalled();
    });
  });
});
