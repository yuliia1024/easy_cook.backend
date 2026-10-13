import { buildNutritionGoal, PROFILE_ID } from '../../../test/fixtures';
import { createPrismaMock, PrismaMock } from '../../../test/prisma-mock';
import { NutritionGoalRepository } from './nutrition-goal.repository';

describe('NutritionGoalRepository', () => {
  let prisma: PrismaMock;
  let repository: NutritionGoalRepository;

  beforeEach(() => {
    prisma = createPrismaMock();
    repository = new NutritionGoalRepository(prisma);
  });

  it('finds the latest goal that is already in effect', async () => {
    const goal = buildNutritionGoal();
    const at = new Date('2026-05-01T00:00:00Z');
    prisma.nutritionGoal.findFirst.mockResolvedValue(goal);

    await expect(repository.findCurrent(PROFILE_ID, at)).resolves.toBe(goal);
    expect(prisma.nutritionGoal.findFirst).toHaveBeenCalledWith({
      where: { profileId: PROFILE_ID, effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
    });
  });

  it('lists the history newest first', async () => {
    await repository.findAll(PROFILE_ID);

    expect(prisma.nutritionGoal.findMany).toHaveBeenCalledWith({
      where: { profileId: PROFILE_ID },
      orderBy: { effectiveFrom: 'desc' },
    });
  });

  it('creates a goal for the profile', async () => {
    const data = {
      caloriesKcal: 2000,
      proteinG: 100,
      fatG: 60,
      carbsG: 250,
      calculationMode: 'manual',
      ruleVersion: null,
    };

    await repository.create(PROFILE_ID, data);

    expect(prisma.nutritionGoal.create).toHaveBeenCalledWith({
      data: { profileId: PROFILE_ID, ...data },
    });
  });
});
