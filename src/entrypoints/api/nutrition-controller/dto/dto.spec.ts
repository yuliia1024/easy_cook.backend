import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { buildNutritionGoal } from '../../../../test/fixtures';
import { PreviewNutritionGoalQueryDto, SetNutritionGoalDto } from './nutrition-goal.dto';
import { NutritionGoalResponseDto } from './nutrition-goal.response.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const fromNow = (ms: number): string => new Date(Date.now() + ms).toISOString();

describe('nutrition goal DTOs', () => {
  const valid = { caloriesKcal: 2100, proteinG: 110, fatG: 70, carbsG: 250 };
  const errorsOf = async (plain: object): Promise<string[]> =>
    (await validate(plainToInstance(SetNutritionGoalDto, plain))).map((e) => e.property);

  it('accepts targets', async () => {
    expect(await errorsOf(valid)).toEqual([]);
  });

  it('parses an ISO start date', async () => {
    const effectiveFrom = fromNow(30 * DAY_MS);
    const dto = plainToInstance(SetNutritionGoalDto, { ...valid, effectiveFrom });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.effectiveFrom).toEqual(new Date(effectiveFrom));
  });

  it.each([
    ['the start of today', -12 * 60 * 60 * 1000],
    ['almost a year ahead', 364 * DAY_MS],
  ])('accepts %s', async (_case, offset) => {
    expect(await errorsOf({ ...valid, effectiveFrom: fromNow(offset) })).toEqual([]);
  });

  it.each([
    ['two days ago', -2 * DAY_MS],
    ['more than a year ahead', 366 * DAY_MS],
  ])('rejects a start %s', async (_case, offset) => {
    expect(await errorsOf({ ...valid, effectiveFrom: fromNow(offset) })).toEqual(['effectiveFrom']);
  });

  it.each([true, 0, '2026-13-01', 'next week'])(
    'rejects %p as a start date',
    async (effectiveFrom) => {
      expect(await errorsOf({ ...valid, effectiveFrom })).toEqual(['effectiveFrom']);
    },
  );

  it.each([
    [{ caloriesKcal: 1199 }, 'caloriesKcal'],
    [{ caloriesKcal: 6001 }, 'caloriesKcal'],
    [{ proteinG: -1 }, 'proteinG'],
    [{ fatG: '70' }, 'fatG'],
    [{ carbsG: 1.25 }, 'carbsG'],
    [{ effectiveFrom: 'tomorrow' }, 'effectiveFrom'],
  ])('rejects %p', async (patch, property) => {
    expect(await errorsOf({ ...valid, ...patch })).toEqual([property]);
  });

  describe('PreviewNutritionGoalQueryDto', () => {
    const parse = async (
      plain: object,
    ): Promise<{ dto: PreviewNutritionGoalQueryDto; errors: string[] }> => {
      const dto = plainToInstance(PreviewNutritionGoalQueryDto, plain);
      return { dto, errors: (await validate(dto)).map((e) => e.property) };
    };

    it('allows no calories', async () => {
      expect((await parse({})).errors).toEqual([]);
    });

    it('parses calories from the query string', async () => {
      const { dto, errors } = await parse({ caloriesKcal: '1500' });

      expect(errors).toEqual([]);
      expect(dto.caloriesKcal).toBe(1500);
    });

    it.each(['1199', '6001', '1500.25', 'abc'])('rejects %p', async (caloriesKcal) => {
      expect((await parse({ caloriesKcal })).errors).toEqual(['caloriesKcal']);
    });
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
