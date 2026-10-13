import { Prisma } from '../../../generated/prisma/client';
import { FoodSource, FoodState } from '../../../common/constants';
import {
  FoodItemNotFoundException,
  FoodItemSourceConflictException,
  FoodItemsNotFoundBadRequestException,
  MacrosExceedWeightBadRequestException,
} from '../../../common/exceptions';
import { createMock } from '../../../test/create-mock';
import { buildFoodItem, FOOD_ID } from '../../../test/fixtures';
import { FoodItemRepository } from '../../data-access/food-item/food-item.repository';
import { FoodItemService } from './food-item.service';

describe('FoodItemService', () => {
  let repository: jest.Mocked<FoodItemRepository>;
  let service: FoodItemService;
  const data = {
    name: 'Гречка суха',
    kcalPer100g: 343,
    proteinG: 13.3,
    fatG: 3.4,
    carbsG: 71.5,
    state: FoodState.Dried,
  };

  beforeEach(() => {
    repository = createMock<FoodItemRepository>();
    repository.findBySource.mockResolvedValue(null);
    service = new FoodItemService(repository);
  });

  it('getPage trims the search', async () => {
    const page = { page: 1, limit: 20 };

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

  describe('assertExist', () => {
    it('passes when every id exists (duplicates allowed)', async () => {
      repository.findExistingIds.mockResolvedValue(['a', 'b']);

      await expect(service.assertExist(['a', 'b', 'a'])).resolves.toBeUndefined();
      expect(repository.findExistingIds).toHaveBeenCalledWith(['a', 'b']);
    });

    it('lists the missing ids', async () => {
      repository.findExistingIds.mockResolvedValue(['a']);

      await expect(service.assertExist(['a', 'b', 'c'])).rejects.toThrow(
        new FoodItemsNotFoundBadRequestException(['b', 'c']),
      );
    });

    it('does not query for an empty list', async () => {
      await service.assertExist([]);

      expect(repository.findExistingIds).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('defaults the source to manual', async () => {
      await service.create(data);

      expect(repository.create).toHaveBeenCalledWith({ ...data, source: FoodSource.Manual });
    });

    it('accepts unknown nutrient values', async () => {
      await service.create({ name: 'Соус', state: FoodState.Other, kcalPer100g: null });

      expect(repository.create).toHaveBeenCalled();
    });

    it('rejects macros heavier than the food', async () => {
      await expect(
        service.create({ ...data, proteinG: 50, fatG: 40, carbsG: 20 }),
      ).rejects.toBeInstanceOf(MacrosExceedWeightBadRequestException);
    });

    it('rejects a taken source id', async () => {
      repository.findBySource.mockResolvedValue(buildFoodItem());

      await expect(
        service.create({ ...data, source: FoodSource.UsdaFdc, sourceId: '123' }),
      ).rejects.toBeInstanceOf(FoodItemSourceConflictException);
      expect(repository.findBySource).toHaveBeenCalledWith(FoodSource.UsdaFdc, '123');
    });

    it('does not check the source without a source id', async () => {
      await service.create(data);

      expect(repository.findBySource).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(buildFoodItem());
    });

    it('saves the changes', async () => {
      await service.update(FOOD_ID, { name: 'New', kcalPer100g: null });

      expect(repository.update).toHaveBeenCalledWith(FOOD_ID, { name: 'New', kcalPer100g: null });
    });

    it('checks the macros merged with the stored values', async () => {
      // stored: protein 2.7, fat 0.3 -> 2.7 + 0.3 + 98 > 100
      await expect(service.update(FOOD_ID, { carbsG: 98 })).rejects.toBeInstanceOf(
        MacrosExceedWeightBadRequestException,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('allows clearing a value', async () => {
      repository.findById.mockResolvedValue(
        buildFoodItem({ proteinG: new Prisma.Decimal(60), carbsG: new Prisma.Decimal(30) }),
      );

      await service.update(FOOD_ID, { proteinG: null, fatG: 50 });

      expect(repository.update).toHaveBeenCalled();
    });

    it('checks a changed source id', async () => {
      repository.findBySource.mockResolvedValue(buildFoodItem({ id: 'other' }));

      await expect(service.update(FOOD_ID, { sourceId: 'taken' })).rejects.toBeInstanceOf(
        FoodItemSourceConflictException,
      );
    });

    it('skips the source check when it did not change', async () => {
      await service.update(FOOD_ID, { name: 'x' });

      expect(repository.findBySource).not.toHaveBeenCalled();
    });

    it('fails for an unknown id', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.update(FOOD_ID, { name: 'x' })).rejects.toBeInstanceOf(
        FoodItemNotFoundException,
      );
    });
  });
});
