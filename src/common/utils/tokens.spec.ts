import { estimateTokens } from './tokens';

describe('estimateTokens', () => {
  it('rounds the characters per token up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(2);
    expect(estimateTokens('abcdef')).toBe(2);
  });
});
