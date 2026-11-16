import { ModelUsage } from '../../src/common/types';

/** USD per 1M tokens. */
export interface ModelPrice {
  input: number;
  cachedInput: number;
  output: number;
}

/**
 * List prices (standard tier) of OpenAI, DeepSeek (peak hours; off-peak is half) and Anthropic. A
 * response may name a dated snapshot (`gpt-4o-mini-2024-07-18`, `claude-haiku-4-5-20251001`),
 * which matches its model; any other name (`gpt-4.1-nano`) has no price. Update when a model or
 * the prices change.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
  'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10 },
  'gpt-4.1-mini': { input: 0.4, cachedInput: 0.1, output: 1.6 },
  'gpt-4.1': { input: 2, cachedInput: 0.5, output: 8 },
  'deepseek-flash': { input: 0.3, cachedInput: 0.006, output: 1.2 },
  'claude-haiku-4-5': { input: 1, cachedInput: 0.1, output: 5 },
};

/** `-2024-07-18` (OpenAI) or `-20251001` (Anthropic). */
const SNAPSHOT_DATE = /^-(\d{4}-\d{2}-\d{2}|\d{8})$/;

export function priceOf(
  modelId: string,
  prices: Record<string, ModelPrice> = MODEL_PRICES,
): ModelPrice | null {
  const key = Object.keys(prices).find(
    (name) =>
      modelId === name ||
      (modelId.startsWith(name) && SNAPSHOT_DATE.test(modelId.slice(name.length))),
  );
  return key ? prices[key] : null;
}

/** The cost of a call in USD, or null when the model has no price. */
export function costUsd(
  modelId: string,
  usage: ModelUsage,
  prices: Record<string, ModelPrice> = MODEL_PRICES,
): number | null {
  const price = priceOf(modelId, prices);
  if (!price) {
    return null;
  }
  const uncached = usage.inputTokens - usage.cachedInputTokens;
  return (
    (uncached * price.input +
      usage.cachedInputTokens * price.cachedInput +
      usage.outputTokens * price.output) /
    1_000_000
  );
}
