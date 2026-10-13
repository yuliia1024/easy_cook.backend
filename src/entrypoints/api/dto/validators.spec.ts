import { plainToInstance } from 'class-transformer';
import { IsBoolean, validate } from 'class-validator';
import { IsNutrientValue, IsOptionalNotNull, ToArray, ToBoolean, Trim } from './validators';

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
