import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
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

    await controller.getPage(query);
    await controller.getById(FOOD_ID);

    expect(service.getPage).toHaveBeenCalledWith(query);
    expect(service.getById).toHaveBeenCalledWith(FOOD_ID);
  });

  it('only reads: the catalog comes from the seed', () => {
    const methods = Object.getOwnPropertyNames(FoodController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) =>
        Reflect.getMetadata(
          METHOD_METADATA,
          FoodController.prototype[name as keyof FoodController],
        ),
      );

    expect(methods).toEqual([RequestMethod.GET, RequestMethod.GET]);
  });
});
