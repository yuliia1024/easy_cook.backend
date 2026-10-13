import { Prisma } from '../../generated/prisma/client';
import { round, toNumber } from './decimal';

describe('toNumber', () => {
  it('converts a Prisma Decimal', () => {
    expect(toNumber(new Prisma.Decimal('12.34'))).toBe(12.34);
  });

  it('passes numbers and numeric strings through', () => {
    expect(toNumber(5)).toBe(5);
    expect(toNumber('7.5')).toBe(7.5);
  });

  it('keeps an unknown value unknown', () => {
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });
});

describe('round', () => {
  it('rounds to one digit by default', () => {
    expect(round(1.25)).toBe(1.3);
    expect(round(1.24)).toBe(1.2);
  });

  it('rounds to the given digits', () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(123.456, 0)).toBe(123);
  });
});
