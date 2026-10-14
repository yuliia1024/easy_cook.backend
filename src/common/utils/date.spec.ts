import { toDate } from './date';

describe('toDate', () => {
  it('reads a day as midnight UTC', () => {
    expect(toDate('2026-10-20')).toEqual(new Date('2026-10-20T00:00:00.000Z'));
  });

  it('keeps a missing day missing', () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate('')).toBeNull();
  });
});
