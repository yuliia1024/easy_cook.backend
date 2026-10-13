import { FoodState, SortOrder } from '../../../common/constants';
import { FoodItemService } from '../../../modules/services/food-item/food-item.service';
import { createMock } from '../../../test/create-mock';
import { buildFoodItem, FOOD_ID } from '../../../test/fixtures';
import { FoodControllerService } from './food-controller.service';

describe('FoodControllerService', () => {
  let foodService: jest.Mocked<FoodItemService>;
  let service: FoodControllerService;

  beforeEach(() => {
    foodService = createMock<FoodItemService>();
    foodService.getById.mockResolvedValue(buildFoodItem());
    foodService.create.mockResolvedValue(buildFoodItem());
    foodService.update.mockResolvedValue(buildFoodItem());
    service = new FoodControllerService(foodService);
  });

  it('pages with filters and maps the items', async () => {
    foodService.getPage.mockResolvedValue({ items: [buildFoodItem()], total: 1 });

    await expect(
      service.getPage({ search: 'rice', state: FoodState.Boiled, page: 1, limit: 10 }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: FOOD_ID, kcalPer100g: 130 })],
      total: 1,
      page: 1,
      limit: 10,
    });
    expect(foodService.getPage).toHaveBeenCalledWith(
      { search: 'rice', state: FoodState.Boiled, source: undefined },
      { page: 1, limit: 10, sortOrder: SortOrder.Asc },
    );
  });

  it('passes the requested sort order', async () => {
    foodService.getPage.mockResolvedValue({ items: [], total: 0 });

    await service.getPage({ sortOrder: SortOrder.Desc });

    expect(foodService.getPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sortOrder: SortOrder.Desc }),
    );
  });

  it('gets, creates and updates', async () => {
    const dto = { name: 'Rice', state: FoodState.Boiled };

    await expect(service.getById(FOOD_ID)).resolves.toMatchObject({ id: FOOD_ID });
    await service.create(dto);
    await service.update(FOOD_ID, { name: 'New' });

    expect(foodService.create).toHaveBeenCalledWith(dto);
    expect(foodService.update).toHaveBeenCalledWith(FOOD_ID, { name: 'New' });
  });
});
