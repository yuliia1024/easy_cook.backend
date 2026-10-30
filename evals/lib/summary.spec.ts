import { buildCaseResult } from '../test/helpers';
import { isFailedCall, latencyStats, metricStats, percentile, summarize } from './summary';
import { RunErrorKind } from './types';

describe('eval summary', () => {
  it('takes the nearest-rank percentile', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    expect(percentile(sorted, 50)).toBe(5);
    expect(percentile(sorted, 95)).toBe(10);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBe(0);
  });

  it('describes the latencies', () => {
    expect(latencyStats([300, 100, 200])).toEqual({
      meanMs: 200,
      p50Ms: 200,
      p95Ms: 300,
      maxMs: 300,
    });
    expect(latencyStats([])).toEqual({ meanMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 });
  });

  it('rates the cases, every field on the cases that score it and every tag', () => {
    const results = [
      buildCaseResult({
        id: 'a',
        tags: ['en', 'direct'],
        fields: [
          { field: 'intent', pass: true, expected: 'x', actual: 'x' },
          { field: 'days', pass: true, expected: 3, actual: 3 },
        ],
      }),
      buildCaseResult({
        id: 'b',
        tags: ['uk', 'direct'],
        pass: false,
        fields: [
          { field: 'intent', pass: true, expected: 'x', actual: 'x' },
          { field: 'days', pass: false, expected: 3, actual: null },
        ],
      }),
      buildCaseResult({
        id: 'c',
        tags: ['uk'],
        pass: false,
        fields: [{ field: 'intent', pass: false, expected: 'x', actual: null }],
        error: { kind: RunErrorKind.InvalidOutput, message: 'bad' },
        latencyMs: 400,
      }),
    ];

    const summary = summarize('intent', results);

    expect(summary).toEqual({
      suite: 'intent',
      models: ['gpt-4o-mini-2024-07-18'],
      cases: { total: 3, passed: 1, rate: 1 / 3 },
      failedCalls: 0,
      invalidOutputs: 1,
      fields: {
        days: { total: 2, passed: 1, rate: 0.5 },
        intent: { total: 3, passed: 2, rate: 2 / 3 },
      },
      tags: {
        direct: { total: 2, passed: 1, rate: 0.5 },
        en: { total: 1, passed: 1, rate: 1 },
        uk: { total: 2, passed: 0, rate: 0 },
      },
      metrics: {},
      usage: { inputTokens: 300, cachedInputTokens: 0, outputTokens: 30 },
      latency: { meanMs: 200, p50Ms: 100, p95Ms: 400, maxMs: 400 },
      costUsd: 0.003,
    });
  });

  it('leaves failed calls out of the rates and latency', () => {
    const failed = buildCaseResult({
      id: 'down',
      tags: ['en'],
      pass: false,
      fields: [],
      error: { kind: RunErrorKind.CallFailed, message: 'timeout' },
      modelId: null,
      latencyMs: 30_000,
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      costUsd: 0,
    });

    const summary = summarize('intent', [buildCaseResult({ tags: ['en'] }), failed]);

    expect(isFailedCall(failed)).toBe(true);
    expect(summary).toMatchObject({
      cases: { total: 1, passed: 1, rate: 1 },
      failedCalls: 1,
      fields: { intent: { total: 1, passed: 1, rate: 1 } },
      tags: { en: { total: 1, passed: 1, rate: 1 } },
      latency: { maxMs: 100 },
    });
  });

  it('averages every metric over the runs that measured it', () => {
    expect(
      metricStats([
        buildCaseResult({ metrics: { retries: 0, calls: 1 } }),
        buildCaseResult({ metrics: { retries: 2 } }),
        buildCaseResult({ metrics: { retries: 0 } }),
        buildCaseResult(),
      ]),
    ).toEqual({
      calls: { runs: 1, mean: 1, max: 1 },
      retries: { runs: 3, mean: 0.67, max: 2 },
    });
  });

  it('leaves the metrics of failed calls out', () => {
    const failed = buildCaseResult({
      error: { kind: RunErrorKind.CallFailed, message: 'timeout' },
      metrics: { retries: 2 },
    });

    expect(summarize('s', [buildCaseResult({ metrics: { retries: 0 } }), failed]).metrics).toEqual({
      retries: { runs: 1, mean: 0, max: 0 },
    });
  });

  it('leaves the cost unknown when a model has no price', () => {
    const summary = summarize('intent', [buildCaseResult(), buildCaseResult({ costUsd: null })]);

    expect(summary.costUsd).toBeNull();
  });

  it('summarizes no results', () => {
    expect(summarize('intent', [])).toMatchObject({
      cases: { total: 0, passed: 0, rate: 0 },
      models: [],
    });
  });
});
