import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { isFailedCall } from './summary';
import { CaseResult, Rate, SuiteSummary } from './types';

/**
 * Standard errors a rate may drop below the baseline before the run fails. The same prompt does not
 * give the same answers every run (no fixed temperature), and a field scored on 23 cases moves
 * more than the pass rate of all 53: 3 runs of each case gave the constraints field 85-91 %.
 */
export const BASELINE_Z = 2;

/**
 * How far a rate measured on `runs` may fall below `rate` by chance: `z` standard errors of the
 * difference of two such rates, at least one run.
 */
export function allowedDrop(rate: number, runs: number, z = BASELINE_Z): number {
  return Math.max(z * Math.sqrt((2 * rate * (1 - rate)) / runs), 1 / runs);
}

/** The committed result of a suite (`evals/baselines/<suite>.json`) a prompt change must not lose. */
export const BaselineSchema = z.object({
  suite: z.string(),
  createdAt: z.string(),
  /** The prompt versions the baseline measured (`promptLabel`). */
  prompts: z.array(z.string()),
  models: z.array(z.string()),
  cases: z.number().int(),
  repeat: z.number().int(),
  passRate: z.number(),
  fields: z.record(z.string(), z.number()),
  tags: z.record(z.string(), z.number()),
  /** The mean of every metric, for reference: not compared. */
  metrics: z.record(z.string(), z.number()).default({}),
  passedCases: z.array(z.string()),
});

export type Baseline = z.infer<typeof BaselineSchema>;

export interface Regression {
  metric: string;
  baseline: number;
  current: number;
}

export interface BaselineComparison {
  regressions: Regression[];
  /** Set when the run used other models than the baseline: the rates are not comparable. */
  modelMismatch: { baseline: string[]; current: string[] } | null;
  /**
   * Set when the run used other prompt versions than the baseline: the change under test. It does
   * not fail the run, the rates do.
   */
  promptChange: { baseline: string[]; current: string[] } | null;
  /** Cases that passed every run of the baseline and fail a run now. */
  newlyFailed: string[];
}

/** Cases that failed a run; failed calls say nothing about the case and do not count. */
const failedCases = (results: CaseResult[]): Set<string> =>
  new Set(
    results.filter((result) => !result.pass && !isFailedCall(result)).map((result) => result.id),
  );

/** `passedCases` are the cases that passed every run the model answered. */
export function toBaseline(summary: SuiteSummary, results: CaseResult[], now: Date): Baseline {
  const rates = (map: SuiteSummary['fields']): Record<string, number> =>
    Object.fromEntries(Object.entries(map).map(([key, { rate }]) => [key, rate]));
  const failed = failedCases(results);
  return {
    suite: summary.suite,
    createdAt: now.toISOString(),
    prompts: summary.prompts,
    models: summary.models,
    cases: new Set(results.map((result) => result.id)).size,
    repeat: Math.max(0, ...results.map((result) => result.attempt)),
    passRate: summary.cases.rate,
    fields: rates(summary.fields),
    tags: rates(summary.tags),
    metrics: Object.fromEntries(
      Object.entries(summary.metrics).map(([metric, { mean }]) => [metric, mean]),
    ),
    passedCases: [
      ...new Set(results.filter((result) => !isFailedCall(result)).map((result) => result.id)),
    ]
      .filter((id) => !failed.has(id))
      .sort(),
  };
}

/**
 * The pass rate and every field rate of the baseline must hold, give or take `allowedDrop`, on the
 * same models.
 */
export function compareWithBaseline(
  summary: SuiteSummary,
  results: CaseResult[],
  baseline: Baseline,
  z = BASELINE_Z,
): BaselineComparison {
  const metrics: Array<[string, number, Rate | undefined]> = [
    ['pass rate', baseline.passRate, summary.cases],
    ...Object.entries(baseline.fields).map(([field, rate]): [string, number, Rate | undefined] => [
      `field ${field}`,
      rate,
      summary.fields[field],
    ]),
  ];
  const failed = failedCases(results);
  const sameModels = baseline.models.join() === summary.models.join();
  const samePrompts = baseline.prompts.join() === summary.prompts.join();

  return {
    regressions: metrics
      .filter(
        ([, base, current]) =>
          !current || current.rate < base - allowedDrop(base, current.total, z) - 1e-9,
      )
      .map(([metric, base, current]) => ({ metric, baseline: base, current: current?.rate ?? 0 })),
    modelMismatch: sameModels ? null : { baseline: baseline.models, current: summary.models },
    promptChange: samePrompts ? null : { baseline: baseline.prompts, current: summary.prompts },
    newlyFailed: baseline.passedCases.filter((id) => failed.has(id)),
  };
}

export const baselineFile = (dir: string, suite: string): string => join(dir, `${suite}.json`);

export function readBaseline(dir: string, suite: string): Baseline | null {
  const file = baselineFile(dir, suite);
  if (!existsSync(file)) {
    return null;
  }
  return BaselineSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

export function writeBaseline(dir: string, baseline: Baseline): string {
  const file = baselineFile(dir, baseline.suite);
  writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`);
  return file;
}
