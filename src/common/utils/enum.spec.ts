import { Sex } from '../constants';
import { parseEnum } from './enum';

describe('parseEnum', () => {
  it('returns a known value', () => {
    expect(parseEnum(Sex, 'female', 'sex')).toBe(Sex.Female);
  });

  it('throws for an unknown value', () => {
    expect(() => parseEnum(Sex, 'other', 'sex')).toThrow('Unknown sex "other" in the database');
  });
});
