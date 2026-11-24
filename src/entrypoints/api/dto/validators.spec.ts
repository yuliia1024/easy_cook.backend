import { plainToInstance } from 'class-transformer';
import { IsBoolean, validate } from 'class-validator';
import { IsOptionalNotNull, ToArray, ToBoolean, Trim } from './validators';

class Sample {
  @Trim()
  name?: string;

  @ToArray()
  tags?: string[];

  @ToBoolean()
  flag?: boolean;

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
});
