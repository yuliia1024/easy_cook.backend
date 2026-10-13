import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { MealType } from '../../../common/constants';
import { createMock } from '../../../test/create-mock';
import { FOOD_ID, INGREDIENT_ID, RECIPE_ID } from '../../../test/fixtures';
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
    const dto = {
      name: 'Rice',
      instructions: 'x',
      mealType: MealType.Lunch,
      servings: 2,
      ingredients: [{ foodItemId: FOOD_ID, quantityG: 100 }],
    };

    await controller.getPage({ search: 'rice' });
    await controller.getById(RECIPE_ID);
    await controller.getNutrition(RECIPE_ID, { includeOptional: true });
    await controller.create(dto);
    await controller.update(RECIPE_ID, { servings: 3 });
    await controller.delete(RECIPE_ID);

    expect(service.getPage).toHaveBeenCalledWith({ search: 'rice' });
    expect(service.getById).toHaveBeenCalledWith(RECIPE_ID);
    expect(service.getNutrition).toHaveBeenCalledWith(RECIPE_ID, { includeOptional: true });
    expect(service.create).toHaveBeenCalledWith(dto);
    expect(service.update).toHaveBeenCalledWith(RECIPE_ID, { servings: 3 });
    expect(service.delete).toHaveBeenCalledWith(RECIPE_ID);
  });

  it('delegates the ingredient routes', async () => {
    const dto = { foodItemId: FOOD_ID, quantityG: 50 };

    await controller.addIngredient(RECIPE_ID, dto);
    await controller.updateIngredient(RECIPE_ID, INGREDIENT_ID, { quantityG: 10 });
    await controller.removeIngredient(RECIPE_ID, INGREDIENT_ID);

    expect(service.addIngredient).toHaveBeenCalledWith(RECIPE_ID, dto);
    expect(service.updateIngredient).toHaveBeenCalledWith(RECIPE_ID, INGREDIENT_ID, {
      quantityG: 10,
    });
    expect(service.removeIngredient).toHaveBeenCalledWith(RECIPE_ID, INGREDIENT_ID);
  });

  it('answers 204 when a recipe is deleted', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, RecipeController.prototype.delete)).toBe(
      HttpStatus.NO_CONTENT,
    );
  });
});
