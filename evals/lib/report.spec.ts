import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCaseResult } from '../test/helpers';
import { EvalReport, formatSuite, SuiteReport, writeReport } from './report';
import { summarize } from './summary';
import { RunErrorKind } from './types';

describe('eval report', () => {
  const results = [
    buildCaseResult({ id: 'ok', tags: ['en'] }),
    buildCaseResult({
      id: 'wrong',
      tags: ['uk'],
      pass: false,
      fields: [
        { field: 'intent', pass: true, expected: 'a', actual: 'a' },
        { field: 'days', pass: false, expected: 3, actual: null },
      ],
    }),
    buildCaseResult({
      id: 'garbled',
      pass: false,
      fields: [{ field: 'intent', pass: false, expected: 'a', actual: null }],
      error: { kind: RunErrorKind.InvalidOutput, message: 'AssistantInvalidOutputException: bad' },
    }),
    buildCaseResult({
      id: 'down',
      pass: false,
      fields: [],
      modelId: null,
      costUsd: 0,
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      error: { kind: RunErrorKind.CallFailed, message: 'Error: timeout' },
    }),
  ];
  const report = (baseline: SuiteReport['baseline']): SuiteReport => ({
    summary: summarize('intent', results),
    baseline,
    results,
  });

  it('prints the rates, failed calls, usage, latency, cost and why each case failed', () => {
    expect(formatSuite(report(null))).toEqual([
      'Suite intent (gpt-4o-mini-2024-07-18)',
      '  pass rate  33.3% (1/3), 1 invalid outputs',
      '  calls      1 failed, left out of the rates and latency',
      '  field      days           0.0% (0/1)',
      '  field      intent         66.7% (2/3)',
      '  tag        en             100.0% (1/1)',
      '  tag        uk             0.0% (0/1)',
      '  tokens     300 in (0 cached) + 30 out',
      '  latency    mean 100ms, p50 100ms, p95 100ms, max 100ms',
      '  cost       $0.0030',
      '  failed',
      '    wrong#1: days: expected 3, got null',
      '    garbled#1: AssistantInvalidOutputException: bad',
      '    down#1: Error: timeout',
    ]);
  });

  it('prints the mean and maximum of every metric', () => {
    const measured = [
      buildCaseResult({ metrics: { retries: 0 } }),
      buildCaseResult({ metrics: { retries: 2 } }),
    ];

    expect(
      formatSuite({ summary: summarize('s', measured), baseline: null, results: measured }),
    ).toContain('  metric     retries        mean 1, max 2 (2 runs)');
  });

  it('prints the comparison with the baseline', () => {
    expect(
      formatSuite(report({ regressions: [], modelMismatch: null, newlyFailed: [] })),
    ).toContain('  baseline   not worse');
    expect(
      formatSuite(
        report({
          regressions: [{ metric: 'field days', baseline: 0.9, current: 0.5 }],
          modelMismatch: null,
          newlyFailed: ['wrong'],
        }),
      ).slice(-2),
    ).toEqual(['  baseline   WORSE: field days 50.0% < 90.0%', '  newly failed wrong']);
  });

  it('prints that the run used other models than the baseline', () => {
    const lines = formatSuite(
      report({
        regressions: [],
        modelMismatch: { baseline: ['gpt-4o-mini-2024-07-18'], current: ['gpt-4.1-mini'] },
        newlyFailed: [],
      }),
    );

    expect(lines.at(-1)).toBe(
      '  baseline   OTHER MODEL: gpt-4.1-mini vs gpt-4o-mini-2024-07-18; ' +
        'save a new baseline with --save-baseline',
    );
  });

  it('prints an unknown cost and a suite no model answered', () => {
    const failed = [buildCaseResult({ modelId: null, costUsd: null })];
    const lines = formatSuite({
      summary: summarize('intent', failed),
      baseline: null,
      results: failed,
    });

    expect(lines[0]).toBe('Suite intent (no model answered)');
    expect(lines).toContain('  cost       unknown (no price for the model)');
  });

  it('writes the report as JSON named after the start', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'evals-')), 'reports');
    const full: EvalReport = {
      startedAt: '2026-10-22T10:00:00.000Z',
      durationMs: 5,
      suites: [report(null)],
    };

    const file = writeReport(dir, full);

    expect(file).toBe(join(dir, '2026-10-22T10-00-00-000Z.json'));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(full);
  });
});
