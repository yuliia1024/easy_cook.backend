import { FoodState } from '../../../common/constants';
import { createMock } from '../../../test/create-mock';
import { FOOD_ID } from '../../../test/fixtures';
import { FoodControllerService } from './food-controller.service';
import { FoodController } from './food.controller';

describe('FoodController', () => {
  let service: jest.Mocked<FoodControllerService>;
  let controller: FoodController;

  beforeEach(() => {
    service = createMock<FoodControllerService>();
    controller = new FoodController(service);
  });

  it('delegates every route', async () => {
    const query = { search: 'rice' };
    const dto = { name: 'Рис', state: FoodState.Raw };

    await controller.getPage(query);
    await controller.getById(FOOD_ID);
    await controller.create(dto);
    await controller.update(FOOD_ID, { name: 'x' });

    expect(service.getPage).toHaveBeenCalledWith(query);
    expect(service.getById).toHaveBeenCalledWith(FOOD_ID);
    expect(service.create).toHaveBeenCalledWith(dto);
    expect(service.update).toHaveBeenCalledWith(FOOD_ID, { name: 'x' });
  });
});
