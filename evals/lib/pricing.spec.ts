import { costUsd, MODEL_PRICES, priceOf } from './pricing';

describe('eval pricing', () => {
  it('matches a model and its dated snapshots only', () => {
    expect(priceOf('gpt-4o-mini-2024-07-18')).toBe(MODEL_PRICES['gpt-4o-mini']);
    expect(priceOf('gpt-4o-2024-08-06')).toBe(MODEL_PRICES['gpt-4o']);
    expect(priceOf('gpt-4o-mini')).toBe(MODEL_PRICES['gpt-4o-mini']);
    expect(priceOf('gpt-4omni')).toBeNull();
    expect(priceOf('gpt-4.1-nano-2025-04-14')).toBeNull();
    expect(priceOf('gpt-4.1-nano')).toBeNull();
    expect(priceOf('gpt-4o-audio-preview')).toBeNull();
    expect(priceOf('gpt-4.1-2025-04-14')).toBe(MODEL_PRICES['gpt-4.1']);
    expect(priceOf('o3')).toBeNull();
    expect(priceOf('claude-haiku-4-5-20251001')).toBe(MODEL_PRICES['claude-haiku-4-5']);
    expect(priceOf('claude-haiku-4-5-2025')).toBeNull();
    expect(priceOf('deepseek-flash')).toBe(MODEL_PRICES['deepseek-flash']);
  });

  it('prices uncached input, cached input and output per 1M tokens', () => {
    const prices = { m: { input: 1, cachedInput: 0.5, output: 4 } };

    expect(
      costUsd(
        'm',
        { inputTokens: 1_000_000, cachedInputTokens: 400_000, outputTokens: 500_000 },
        prices,
      ),
    ).toBeCloseTo(0.6 + 0.2 + 2);
  });

  it('returns null for a model without a price', () => {
    expect(
      costUsd('unknown', { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }),
    ).toBeNull();
  });
});
