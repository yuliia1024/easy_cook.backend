import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAiService } from '../../src/providers/open-ai/open-ai.service';
import { AssistantUnavailableException } from '../../src/common/exceptions';
import { createMock } from '../../src/test/create-mock';
import { EvalArgs } from './args';
import { baselineFile, readBaseline } from './baseline';
import { EvalReport } from './report';
import { MAX_FAILED_CALLS_SHARE, runEvals } from './run-evals';
import { buildEchoSuite, EchoCase } from '../test/helpers';

describe('runEvals', () => {
  const openAi = createMock<OpenAiService>();
  const usage = { inputTokens: 10, cachedInputTokens: 0, outputTokens: 1 };
  const now = (): Date => new Date('2026-10-22T10:00:00Z');
  let root: string;
  let dirs: { baselines: string; reports: string };
  let lines: string[];

  const args = (overrides: Partial<EvalArgs> = {}): EvalArgs => ({
    suites: [],
    saveBaseline: false,
    concurrency: 2,
    repeat: 1,
    ...overrides,
  });
  /**
   * A suite of `count` cases (`c0`, `c1`...): the first `passing` get the right answer, the last
   * `down` fail their call.
   */
  const suiteOf = (
    name: string,
    count: number,
    passing: number,
    { down = 0, modelId = 'gpt-4o-mini' }: { down?: number; modelId?: string } = {},
  ) => {
    const file = join(root, `${name}.jsonl`);
    writeFileSync(
      file,
      Array.from({ length: count }, (_, i) => `{"id":"c${i}","answer":"x"}`).join('\n'),
    );
    const suite = { ...buildEchoSuite(file), name };
    suite.run.mockImplementation(async (c: EchoCase) => {
      const index = Number(c.id.slice(1));
      if (index >= count - down) {
        throw new AssistantUnavailableException(true);
      }
      return { output: index < passing ? 'x' : 'no', modelId, latencyMs: 1, usage };
    });
    return suite;
  };
  const report = (file: string): EvalReport => JSON.parse(readFileSync(file, 'utf8'));

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'evals-'));
    dirs = { baselines: root, reports: join(root, 'reports') };
    lines = [];
  });

  it('runs the chosen suites only, prints them and writes the report', async () => {
    const intent = suiteOf('intent', 2, 2);
    const other = suiteOf('other', 2, 0);

    const outcome = await runEvals(
      args({ suites: ['intent'] }),
      [intent, other],
      openAi,
      dirs,
      (l) => lines.push(l),
      now,
    );

    expect(outcome.ok).toBe(true);
    expect(other.run).not.toHaveBeenCalled();
    expect(lines).toEqual(
      expect.arrayContaining([
        'Running intent: 2 cases x 1',
        'No baseline for intent; save one with --save-baseline',
        '  pass rate  100.0% (2/2)',
        `Report: ${outcome.reportFile}`,
      ]),
    );
    const written = report(outcome.reportFile);
    expect(written.startedAt).toBe('2026-10-22T10:00:00.000Z');
    expect(written.suites.map((s) => s.summary.suite)).toEqual(['intent']);
    expect(written.suites[0].results).toHaveLength(2);
  });

  it('runs every suite when none is chosen', async () => {
    const intent = suiteOf('intent', 1, 1);
    const other = suiteOf('other', 1, 1);

    await runEvals(args(), [intent, other], openAi, dirs, () => undefined, now);

    expect(intent.run).toHaveBeenCalled();
    expect(other.run).toHaveBeenCalled();
  });

  it('saves the baseline instead of comparing with it', async () => {
    await runEvals(
      args({ saveBaseline: true }),
      [suiteOf('intent', 2, 1)],
      openAi,
      dirs,
      (l) => lines.push(l),
      now,
    );

    expect(readBaseline(dirs.baselines, 'intent')).toMatchObject({
      prompts: ['echo@v1'],
      passRate: 0.5,
      passedCases: ['c0'],
    });
    expect(lines).toContain(`Baseline saved: ${join(root, 'intent.json')}`);
  });

  it('names the prompt versions in the report and compares a new version with the baseline', async () => {
    await runEvals(
      args({ saveBaseline: true }),
      [suiteOf('intent', 2, 2)],
      openAi,
      dirs,
      () => undefined,
      now,
    );
    const changed = suiteOf('intent', 2, 2);
    changed.prompts = [{ name: 'echo', version: 2, instructions: 'Echo it.' }];

    const outcome = await runEvals(args(), [changed], openAi, dirs, (l) => lines.push(l), now);

    expect(outcome.ok).toBe(true);
    const written = report(outcome.reportFile).suites[0];
    expect(written.summary.prompts).toEqual(['echo@v2']);
    expect(written.baseline?.promptChange).toEqual({ baseline: ['echo@v1'], current: ['echo@v2'] });
    expect(lines).toContain('  baseline   prompts echo@v1 -> echo@v2');
  });

  it('passes within the tolerance and fails when a suite is worse than its baseline', async () => {
    await runEvals(
      args({ saveBaseline: true }),
      [suiteOf('intent', 25, 20)],
      openAi,
      dirs,
      () => undefined,
      now,
    );

    const within = await runEvals(
      args(),
      [suiteOf('intent', 25, 19)],
      openAi,
      dirs,
      () => undefined,
      now,
    );
    const worse = await runEvals(
      args(),
      [suiteOf('intent', 25, 14)],
      openAi,
      dirs,
      (l) => lines.push(l),
      now,
    );

    expect(within.ok).toBe(true);
    expect(worse.ok).toBe(false);
    expect(report(worse.reportFile).suites[0].baseline).toEqual({
      regressions: [
        { metric: 'pass rate', baseline: 0.8, current: 0.56 },
        { metric: 'field answer', baseline: 0.8, current: 0.56 },
      ],
      modelMismatch: null,
      promptChange: null,
      newlyFailed: ['c14', 'c15', 'c16', 'c17', 'c18', 'c19'],
    });
    expect(lines).toContain(
      '  baseline   WORSE: pass rate 56.0% < 80.0%, field answer 56.0% < 80.0%',
    );
  });

  it('does not save a baseline from a run with failed calls', async () => {
    const outcome = await runEvals(
      args({ saveBaseline: true }),
      [suiteOf('intent', 5, 5, { down: 1 })],
      openAi,
      dirs,
      (l) => lines.push(l),
      now,
    );

    expect(outcome.ok).toBe(false);
    expect(existsSync(baselineFile(dirs.baselines, 'intent'))).toBe(false);
    expect(lines).toContain('Baseline not saved: 1 calls failed; run intent again');
  });

  it('compares without the failed calls and fails only when too many calls failed', async () => {
    await runEvals(
      args({ saveBaseline: true }),
      [suiteOf('intent', 20, 20)],
      openAi,
      dirs,
      () => undefined,
      now,
    );

    const few = await runEvals(
      args(),
      [suiteOf('intent', 20, 20, { down: 2 })],
      openAi,
      dirs,
      () => undefined,
      now,
    );
    const many = await runEvals(
      args(),
      [suiteOf('intent', 20, 20, { down: 3 })],
      openAi,
      dirs,
      (l) => lines.push(l),
      now,
    );

    expect(MAX_FAILED_CALLS_SHARE).toBe(0.1);
    expect(few.ok).toBe(true);
    expect(report(few.reportFile).suites[0].baseline?.regressions).toEqual([]);
    expect(many.ok).toBe(false);
    expect(lines).toContain('Incomplete: 3 of 20 calls failed; run intent again');
  });

  it('fails a run on other models than the baseline', async () => {
    await runEvals(
      args({ saveBaseline: true }),
      [suiteOf('intent', 2, 2)],
      openAi,
      dirs,
      () => undefined,
      now,
    );

    const outcome = await runEvals(
      args(),
      [suiteOf('intent', 2, 2, { modelId: 'gpt-4.1-mini' })],
      openAi,
      dirs,
      () => undefined,
      now,
    );

    expect(outcome.ok).toBe(false);
    expect(report(outcome.reportFile).suites[0].baseline?.modelMismatch).toEqual({
      baseline: ['gpt-4o-mini'],
      current: ['gpt-4.1-mini'],
    });
  });
});
