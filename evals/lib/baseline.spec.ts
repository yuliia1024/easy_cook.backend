import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  allowedDrop,
  Baseline,
  baselineFile,
  baselinesDir,
  compareWithBaseline,
  readBaseline,
  toBaseline,
  writeBaseline,
} from './baseline';
import { ModelProviderName } from '../../src/common/constants';
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
      prompts: [],
      models: ['gpt-4o-mini-2024-07-18'],
      cases: 4,
      repeat: 1,
      passRate: 0.75,
      fields: { intent: 0.75 },
      tags: { en: 0.75 },
      metrics: {},
      passedCases: ['c00', 'c01', 'c02'],
    });
  });

  it('keeps the mean of every metric', () => {
    const runs = [
      buildCaseResult({ id: 'a', metrics: { retries: 0 } }),
      buildCaseResult({ id: 'b', metrics: { retries: 1 } }),
    ];

    expect(toBaseline(summarize('s', runs), runs, new Date()).metrics).toEqual({ retries: 0.5 });
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

  it('compares a run of some tags by the rates of those tags only', () => {
    const tagged = (count: number, passed: number): CaseResult[] =>
      Array.from({ length: count }, (_, i) =>
        buildCaseResult({
          id: `s${i}`,
          tags: ['save'],
          pass: i < passed,
          fields: [{ field: 'intent', pass: i < passed, expected: 'a', actual: 'a' }],
        }),
      );
    const base = [...results(20, 20), ...tagged(10, 10)];
    const baseline = toBaseline(summarize('intent', base), base, new Date());
    const current = tagged(10, 5);

    expect(
      compareWithBaseline(summarize('intent', current), current, baseline, ['save', 'missing']),
    ).toMatchObject({
      regressions: [{ metric: 'tag save', baseline: 1, current: 0.5 }],
      newlyFailed: ['s5', 's6', 's7', 's8', 's9'],
    });
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

  it('names the prompt versions of the run when they differ from the baseline', () => {
    const current = results(4, 4);
    const baseline = { ...baselineOf(4, 4), prompts: ['intent@v1'] };

    expect(
      compareWithBaseline(summarize('intent', current, ['intent@v1']), current, baseline)
        .promptChange,
    ).toBeNull();
    expect(
      compareWithBaseline(summarize('intent', current, ['intent@v2']), current, baseline),
    ).toMatchObject({
      regressions: [],
      promptChange: { baseline: ['intent@v1'], current: ['intent@v2'] },
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

  it('keeps the baselines of a fallback provider in a folder of its own', () => {
    expect(baselinesDir('/b', ModelProviderName.OpenAi)).toBe('/b');
    expect(baselinesDir('/b', ModelProviderName.DeepSeek)).toBe(join('/b', 'deepseek'));
  });

  it('creates the folder of a baseline', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'evals-')), 'deepseek');

    writeBaseline(dir, baselineOf(2, 1));

    expect(readBaseline(dir, 'intent')).toEqual(baselineOf(2, 1));
  });

  it('reads a baseline saved without metrics', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evals-'));
    const { metrics: _metrics, ...older } = baselineOf(2, 1);
    writeFileSync(baselineFile(dir, 'intent'), JSON.stringify(older));

    expect(readBaseline(dir, 'intent')?.metrics).toEqual({});
  });
});
