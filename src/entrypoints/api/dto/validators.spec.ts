import { plainToInstance } from 'class-transformer';
import { IsBoolean, validate } from 'class-validator';
import {
  IsNutrientValue,
  IsOptionalNotNull,
  IsUpcomingDate,
  ToArray,
  ToBoolean,
  Trim,
} from './validators';

class Sample {
  @Trim()
  name?: string;

  @ToArray()
  tags?: string[];

  @ToBoolean()
  flag?: boolean;

  @IsNutrientValue(100)
  protein?: number | null;

  @IsOptionalNotNull()
  @IsBoolean()
  done?: boolean;
}

const build = (plain: object): Sample => plainToInstance(Sample, plain);

class DateSample {
  @IsUpcomingDate(365)
  day: unknown;
}

describe('validators', () => {
  it('Trim trims strings only', () => {
    expect(build({ name: '  a ' }).name).toBe('a');
    expect(build({ name: 5 }).name).toBe(5);
  });

  it.each([
    [undefined, undefined],
    ['', undefined],
    ['a', ['a']],
    ['a, b', ['a', 'b']],
    [
      ['a', 'b,c'],
      ['a', 'b', 'c'],
    ],
    ['a,,', ['a']],
  ])('ToArray %p -> %p', (input, expected) => {
    expect(build({ tags: input }).tags).toEqual(expected);
  });

  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['yes', false],
  ])('ToBoolean %p -> %p', (input, expected) => {
    expect(build({ flag: input }).flag).toBe(expected);
  });

  describe('IsUpcomingDate', () => {
    const errorOf = async (day: unknown): Promise<string | undefined> => {
      const [error] = await validate(plainToInstance(DateSample, { day }));
      return error && Object.values(error.constraints ?? {})[0];
    };

    beforeEach(() => {
      jest.useFakeTimers({ now: new Date('2026-10-14T12:00:00Z'), doNotFake: ['queueMicrotask'] });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it.each(['2026-10-14', '2026-12-31', '2027-10-14'])('accepts %s', async (day) => {
      expect(await errorOf(day)).toBeUndefined();
    });

    it('allows a day of slack for the time zone of the client', async () => {
      expect(await errorOf('2026-10-13')).toBeUndefined();
      expect(await errorOf('2027-10-15')).toBeUndefined();
    });

    it.each([
      ['2026-10-12', 'day cannot be in the past'],
      ['2027-10-16', 'day cannot be more than 365 days ahead'],
      ['2026-02-30', 'day must be YYYY-MM-DD'],
      ['14.10.2026', 'day must be YYYY-MM-DD'],
      ['2026-10-20T00:00:00Z', 'day must be YYYY-MM-DD'],
      [20261020, 'day must be YYYY-MM-DD'],
    ])('rejects %p', async (day, message) => {
      expect(await errorOf(day)).toBe(message);
    });
  });

  describe('IsOptionalNotNull', () => {
    it.each([{}, { done: true }])('accepts %p', async (plain) => {
      expect(await validate(build(plain))).toHaveLength(0);
    });

    it('rejects null', async () => {
      expect((await validate(build({ done: null }))).map((e) => e.property)).toEqual(['done']);
    });
  });

  describe('IsNutrientValue', () => {
    const errors = async (protein: unknown): Promise<number> =>
      (await validate(build({ protein }))).length;

    it.each([undefined, null, 0, 12.5, 100])('accepts %p', async (value) => {
      expect(await errors(value)).toBe(0);
    });

    it.each([-1, 100.5, 1.234, '5', Number.NaN])('rejects %p', async (value) => {
      expect(await errors(value)).toBe(1);
    });
  });
});
