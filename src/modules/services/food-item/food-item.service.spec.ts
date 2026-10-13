import { Prisma } from '../../../generated/prisma/client';
import { FoodSource, FoodState, SortOrder } from '../../../common/constants';
import {
  FoodItemNotFoundException,
  FoodItemSourceConflictException,
  FoodItemsNotFoundBadRequestException,
  FoodKcalMismatchBadRequestException,
  FoodStateInUseConflictException,
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
    name: 'Buckwheat, dry',
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

  describe('create', () => {
    it('defaults the source to manual', async () => {
      await service.create(data);

      expect(repository.create).toHaveBeenCalledWith({ ...data, source: FoodSource.Manual });
    });

    it('accepts unknown nutrient values', async () => {
      await service.create({ name: 'Sauce', state: FoodState.Other, kcalPer100g: null });

      expect(repository.create).toHaveBeenCalled();
    });

    it('rejects macros heavier than the food', async () => {
      await expect(
        service.create({ ...data, proteinG: 50, fatG: 40, carbsG: 20 }),
      ).rejects.toBeInstanceOf(MacrosExceedWeightBadRequestException);
    });

    it.each([
      // 4*10 + 9*10 + 4*10 = 170 kcal; 25 % = 42.5 kcal
      ['too high', 220],
      ['too low', 120],
    ])('rejects kcal %s for the macros', async (_case, kcalPer100g) => {
      await expect(
        service.create({ ...data, kcalPer100g, proteinG: 10, fatG: 10, carbsG: 10 }),
      ).rejects.toThrow(new FoodKcalMismatchBadRequestException(kcalPer100g, 170));
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('allows at least 20 kcal of difference for lean foods', async () => {
      // cucumber-like: 4*0.7 + 9*0.1 + 4*3.6 = 18.1 kcal
      await service.create({ ...data, kcalPer100g: 36, proteinG: 0.7, fatG: 0.1, carbsG: 3.6 });

      expect(repository.create).toHaveBeenCalled();
    });

    it('skips the kcal check while a value is unknown', async () => {
      await service.create({ ...data, kcalPer100g: 900, fatG: null });

      expect(repository.create).toHaveBeenCalled();
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

    it('checks the kcal merged with the stored macros', async () => {
      // stored rice: 2.7 / 0.3 / 28.2 g -> 126.3 kcal
      await expect(service.update(FOOD_ID, { kcalPer100g: 300 })).rejects.toBeInstanceOf(
        FoodKcalMismatchBadRequestException,
      );
    });

    it('lets a stored row that fails the kcal check be renamed', async () => {
      repository.findById.mockResolvedValue(
        buildFoodItem({ kcalPer100g: new Prisma.Decimal(500) }),
      );

      // The web form sends the unchanged nutrients along with the name.
      await service.update(FOOD_ID, {
        name: 'Renamed',
        kcalPer100g: 500,
        proteinG: 2.7,
        fatG: 0.3,
        carbsG: 28.2,
      });

      expect(repository.update).toHaveBeenCalled();
    });

    it('rejects a state change of a food used in recipes', async () => {
      repository.isUsedInRecipes.mockResolvedValue(true);

      await expect(service.update(FOOD_ID, { state: FoodState.Raw })).rejects.toBeInstanceOf(
        FoodStateInUseConflictException,
      );
      expect(repository.isUsedInRecipes).toHaveBeenCalledWith(FOOD_ID);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('changes the state of an unused food', async () => {
      repository.isUsedInRecipes.mockResolvedValue(false);

      await service.update(FOOD_ID, { state: FoodState.Raw });

      expect(repository.update).toHaveBeenCalledWith(FOOD_ID, { state: FoodState.Raw });
    });

    it('does not look for recipes when the state stays', async () => {
      await service.update(FOOD_ID, { state: FoodState.Boiled });

      expect(repository.isUsedInRecipes).not.toHaveBeenCalled();
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
