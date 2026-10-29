import { ModelUsage } from '../../src/common/types';
import { CaseResult, LatencyStats, MetricStats, Rate, RunErrorKind, SuiteSummary } from './types';

const rate = (total: number, passed: number): Rate => ({
  total,
  passed,
  rate: total === 0 ? 0 : passed / total,
});

/** Nearest-rank percentile of sorted values. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function latencyStats(values: number[]): LatencyStats {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    meanMs: sorted.length === 0 ? 0 : Math.round(sum / sorted.length),
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    maxMs: sorted.at(-1) ?? 0,
  };
}

/** Mean (to 2 decimals) and maximum of every metric over the runs that measured it. */
export function metricStats(results: CaseResult[]): Record<string, MetricStats> {
  const values = new Map<string, number[]>();
  for (const result of results) {
    for (const [metric, value] of Object.entries(result.metrics)) {
      values.set(metric, [...(values.get(metric) ?? []), value]);
    }
  }
  return Object.fromEntries(
    [...values.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([metric, list]) => [
        metric,
        {
          runs: list.length,
          mean: Math.round((list.reduce((sum, value) => sum + value, 0) / list.length) * 100) / 100,
          max: Math.max(...list),
        },
      ]),
  );
}

/** A run whose call failed (timeout, rate limit) and says nothing about the prompt. */
export const isFailedCall = (result: CaseResult): boolean =>
  result.error?.kind === RunErrorKind.CallFailed;

/**
 * Pass rate of the runs of the cases, of every scored field and of every tag; the metrics of the
 * suite; tokens, latency and cost of the calls. A field counts only on the cases that score it. With `--repeat` every run
 * counts, so a case that passes 2 of 3 times adds 2/3. Failed calls are counted apart and left out
 * of the rates and latency; invalid output fails its fields.
 */
export function summarize(suite: string, results: CaseResult[]): SuiteSummary {
  const fields = new Map<string, { total: number; passed: number }>();
  const tags = new Map<string, { total: number; passed: number }>();
  const count = (map: typeof fields, key: string, pass: boolean): void => {
    const entry = map.get(key) ?? { total: 0, passed: 0 };
    entry.total += 1;
    entry.passed += pass ? 1 : 0;
    map.set(key, entry);
  };

  const answered = results.filter((result) => !isFailedCall(result));
  const usage: ModelUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  const models = new Set<string>();
  let cost: number | null = 0;

  for (const result of answered) {
    result.fields.forEach((field) => count(fields, field.field, field.pass));
    result.tags.forEach((tag) => count(tags, tag, result.pass));
  }
  for (const result of results) {
    usage.inputTokens += result.usage.inputTokens;
    usage.cachedInputTokens += result.usage.cachedInputTokens;
    usage.outputTokens += result.usage.outputTokens;
    if (result.modelId) {
      models.add(result.modelId);
    }
    cost = cost === null || result.costUsd === null ? null : cost + result.costUsd;
  }

  const toRates = (map: typeof fields): Record<string, Rate> =>
    Object.fromEntries(
      [...map.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, { total, passed }]) => [key, rate(total, passed)]),
    );

  return {
    suite,
    models: [...models].sort(),
    cases: rate(answered.length, answered.filter((result) => result.pass).length),
    failedCalls: results.length - answered.length,
    invalidOutputs: results.filter((result) => result.error?.kind === RunErrorKind.InvalidOutput)
      .length,
    fields: toRates(fields),
    tags: toRates(tags),
    metrics: metricStats(answered),
    usage,
    latency: latencyStats(answered.map((result) => result.latencyMs)),
    costUsd: cost,
  };
}
