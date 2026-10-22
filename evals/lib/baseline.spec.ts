import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  allowedDrop,
  Baseline,
  baselineFile,
  compareWithBaseline,
  readBaseline,
  toBaseline,
  writeBaseline,
} from './baseline';
import { summarize } from './summary';
import { buildCaseResult } from '../test/helpers';
import { CaseResult, RunErrorKind } from './types';

describe('eval baseline', () => {
  /** `count` cases, the first `passed` of them passing their `intent` field. */
  const results = (count: number, passed: number): CaseResult[] =>
    Array.from({ length: count }, (_, i) =>
      buildCaseResult({
        id: `c${String(i).padStart(2, '0')}`,
        tags: ['en'],
        pass: i < passed,
        fields: [{ field: 'intent', pass: i < passed, expected: 'a', actual: 'a' }],
      }),
    );
  const baselineOf = (count: number, passed: number): Baseline => {
    const base = results(count, passed);
    return toBaseline(summarize('intent', base), base, new Date('2026-10-22T10:00:00Z'));
  };

  it('keeps the rates, the models and the passed cases', () => {
    expect(baselineOf(4, 3)).toEqual({
      suite: 'intent',
      createdAt: '2026-10-22T10:00:00.000Z',
      models: ['gpt-4o-mini-2024-07-18'],
      cases: 4,
      repeat: 1,
      passRate: 0.75,
      fields: { intent: 0.75 },
      tags: { en: 0.75 },
      passedCases: ['c00', 'c01', 'c02'],
    });
  });

  it('keeps only the cases that passed every run', () => {
    const runs = [
      buildCaseResult({ id: 'a', attempt: 1 }),
      buildCaseResult({ id: 'b', attempt: 1 }),
      buildCaseResult({ id: 'a', attempt: 2 }),
      buildCaseResult({ id: 'b', attempt: 2, pass: false }),
    ];

    expect(toBaseline(summarize('intent', runs), runs, new Date())).toMatchObject({
      cases: 2,
      repeat: 2,
      passRate: 0.75,
      passedCases: ['a'],
    });
  });

  it('allows a drop of two standard errors of the difference, at least one run', () => {
    expect(allowedDrop(0.8, 50)).toBeCloseTo(0.16);
    expect(allowedDrop(0.5, 200, 1)).toBeCloseTo(0.05);
    expect(allowedDrop(1, 159)).toBeCloseTo(1 / 159);
  });

  it('is not worse within the allowed drop', () => {
    const current = results(50, 32);

    const comparison = compareWithBaseline(
      summarize('intent', current),
      current,
      baselineOf(50, 40),
    );

    expect(comparison.regressions).toEqual([]);
    expect(comparison.modelMismatch).toBeNull();
    expect(comparison.newlyFailed).toHaveLength(8);
  });

  it('reports every rate that dropped more than allowed', () => {
    const current = results(50, 31);

    const { regressions } = compareWithBaseline(
      summarize('intent', current),
      current,
      baselineOf(50, 40),
    );

    expect(regressions).toEqual([
      { metric: 'pass rate', baseline: 0.8, current: 0.62 },
      { metric: 'field intent', baseline: 0.8, current: 0.62 },
    ]);
  });

  it('reports a field of the baseline the run no longer scores', () => {
    const current = results(4, 4).map((result) => ({ ...result, fields: [] }));

    const { regressions } = compareWithBaseline(
      summarize('intent', current),
      current,
      baselineOf(4, 4),
    );

    expect(regressions).toEqual([{ metric: 'field intent', baseline: 1, current: 0 }]);
  });

  it('flags a run on other models than the baseline', () => {
    const current = results(4, 4).map((result) => ({ ...result, modelId: 'gpt-4.1-mini' }));

    const { modelMismatch } = compareWithBaseline(
      summarize('intent', current),
      current,
      baselineOf(4, 4),
    );

    expect(modelMismatch).toEqual({
      baseline: ['gpt-4o-mini-2024-07-18'],
      current: ['gpt-4.1-mini'],
    });
  });

  it('ignores failed calls in the passed and the newly failed cases', () => {
    const down = (id: string): CaseResult =>
      buildCaseResult({
        id,
        pass: false,
        fields: [],
        modelId: null,
        error: { kind: RunErrorKind.CallFailed, message: 'timeout' },
      });
    const base = [buildCaseResult({ id: 'a' }), down('a'), down('b')];
    const baseline = toBaseline(summarize('intent', base), base, new Date());

    expect(baseline.passedCases).toEqual(['a']);
    expect(
      compareWithBaseline(summarize('intent', base), [down('a')], baseline).newlyFailed,
    ).toEqual([]);
  });

  it('writes and reads a baseline file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evals-'));
    const baseline = baselineOf(2, 1);

    expect(readBaseline(dir, 'intent')).toBeNull();
    expect(writeBaseline(dir, baseline)).toBe(baselineFile(dir, 'intent'));
    expect(readBaseline(dir, 'intent')).toEqual(baseline);
  });
});
