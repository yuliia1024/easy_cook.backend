import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { createMock } from '../../../test/create-mock';
import { RECIPE_ID } from '../../../test/fixtures';
import { RecipeControllerService } from './recipe-controller.service';
import { RecipeController } from './recipe.controller';

describe('RecipeController', () => {
  let service: jest.Mocked<RecipeControllerService>;
  let controller: RecipeController;

  beforeEach(() => {
    service = createMock<RecipeControllerService>();
    controller = new RecipeController(service);
  });

  it('delegates the recipe routes', async () => {
    await controller.getPage({ search: 'rice' });
    await controller.getById(RECIPE_ID);
    await controller.getNutrition(RECIPE_ID, { includeOptional: true });

    expect(service.getPage).toHaveBeenCalledWith({ search: 'rice' });
    expect(service.getById).toHaveBeenCalledWith(RECIPE_ID);
    expect(service.getNutrition).toHaveBeenCalledWith(RECIPE_ID, { includeOptional: true });
  });

  it('only reads: the catalog comes from the seed', () => {
    const methods = Object.getOwnPropertyNames(RecipeController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) =>
        Reflect.getMetadata(
          METHOD_METADATA,
          RecipeController.prototype[name as keyof RecipeController],
        ),
      );

    expect(methods).toEqual([RequestMethod.GET, RequestMethod.GET, RequestMethod.GET]);
  });
});
