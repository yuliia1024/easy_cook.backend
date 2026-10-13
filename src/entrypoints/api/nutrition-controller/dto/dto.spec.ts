import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { buildNutritionGoal } from '../../../../test/fixtures';
import { SetNutritionGoalDto } from './nutrition-goal.dto';
import { NutritionGoalResponseDto } from './nutrition-goal.response.dto';

describe('nutrition goal DTOs', () => {
  const valid = { caloriesKcal: 2100, proteinG: 110, fatG: 70, carbsG: 250 };
  const errorsOf = async (plain: object): Promise<string[]> =>
    (await validate(plainToInstance(SetNutritionGoalDto, plain))).map((e) => e.property);

  it('accepts targets', async () => {
    expect(await errorsOf(valid)).toEqual([]);
  });

  it('parses an ISO start date', async () => {
    const dto = plainToInstance(SetNutritionGoalDto, {
      ...valid,
      effectiveFrom: '2026-11-01T00:00:00Z',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.effectiveFrom).toEqual(new Date('2026-11-01T00:00:00Z'));
  });

  it.each([
    [{ caloriesKcal: 500 }, 'caloriesKcal'],
    [{ proteinG: -1 }, 'proteinG'],
    [{ fatG: '70' }, 'fatG'],
    [{ carbsG: 1.25 }, 'carbsG'],
    [{ effectiveFrom: 'tomorrow' }, 'effectiveFrom'],
  ])('rejects %p', async (patch, property) => {
    expect(await errorsOf({ ...valid, ...patch })).toEqual([property]);
  });

  it('maps a goal', () => {
    const goal = buildNutritionGoal();

    expect(NutritionGoalResponseDto.from(goal)).toEqual({
      id: goal.id,
      caloriesKcal: 2000,
      proteinG: 104,
      fatG: 56,
      carbsG: 270,
      calculationMode: 'manual',
      ruleVersion: null,
      effectiveFrom: goal.effectiveFrom,
    });
  });
});
