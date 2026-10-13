import { NutritionGoalService } from '../../../modules/services/nutrition-goal/nutrition-goal.service';
import { createMock } from '../../../test/create-mock';
import { buildNutritionGoal } from '../../../test/fixtures';
import { NutritionControllerService } from './nutrition-controller.service';

describe('NutritionControllerService', () => {
  let goalService: jest.Mocked<NutritionGoalService>;
  let service: NutritionControllerService;
  const targets = { caloriesKcal: 2000, proteinG: 104, fatG: 56, carbsG: 270 };

  beforeEach(() => {
    goalService = createMock<NutritionGoalService>();
    goalService.getCurrent.mockResolvedValue(buildNutritionGoal());
    goalService.getHistory.mockResolvedValue([buildNutritionGoal()]);
    goalService.setManual.mockResolvedValue(buildNutritionGoal());
    goalService.calculate.mockResolvedValue(buildNutritionGoal());
    service = new NutritionControllerService(goalService);
  });

  it('maps the current goal and the history', async () => {
    await expect(service.getCurrent()).resolves.toMatchObject(targets);
    await expect(service.getHistory()).resolves.toEqual([expect.objectContaining(targets)]);
  });

  it('splits the start date from the targets', async () => {
    const effectiveFrom = new Date('2026-11-01T00:00:00Z');

    await service.setManual({ ...targets, effectiveFrom });

    expect(goalService.setManual).toHaveBeenCalledWith(targets, effectiveFrom);
  });

  it('previews and calculates', async () => {
    goalService.preview.mockResolvedValue(targets);

    await expect(service.preview()).resolves.toEqual(targets);
    await expect(service.calculate()).resolves.toMatchObject(targets);
  });
});
