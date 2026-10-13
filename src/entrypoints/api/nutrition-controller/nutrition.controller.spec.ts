import { createMock } from '../../../test/create-mock';
import { NutritionControllerService } from './nutrition-controller.service';
import { NutritionController } from './nutrition.controller';

describe('NutritionController', () => {
  let service: jest.Mocked<NutritionControllerService>;
  let controller: NutritionController;

  beforeEach(() => {
    service = createMock<NutritionControllerService>();
    controller = new NutritionController(service);
  });

  it('delegates every route', async () => {
    const dto = { caloriesKcal: 2000, proteinG: 100, fatG: 60, carbsG: 250 };

    await controller.getHistory();
    await controller.getCurrent();
    await controller.preview();
    await controller.setManual(dto);
    await controller.calculate();

    expect(service.getHistory).toHaveBeenCalled();
    expect(service.getCurrent).toHaveBeenCalled();
    expect(service.preview).toHaveBeenCalled();
    expect(service.setManual).toHaveBeenCalledWith(dto);
    expect(service.calculate).toHaveBeenCalled();
  });
});
