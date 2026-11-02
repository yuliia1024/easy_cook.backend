import { z } from 'zod';
import { ModelCallInfo, ModelUsage } from '../../src/common/types';
import { ModelResult, OpenAiService } from '../../src/providers/open-ai/open-ai.service';

/** What every line of a suite's `cases.jsonl` has; a suite adds its input and expectations. */
export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;

/** One checked field of a case: what was expected and what the model gave. */
export interface FieldScore {
  field: string;
  pass: boolean;
  expected: unknown;
  actual: unknown;
}

/** The model result of a case and the numbers the suite measured on the way (`metrics`). */
export interface SuiteRun<T> extends ModelResult<T> {
  /** Measured per run and averaged in the summary, e.g. the retries a plan needed. */
  metrics?: Record<string, number>;
  /**
   * The judge call of the run (`runJudge`), when there was one: its cost is in the case's, its
   * model and tokens are not, so `usage` stays what the prompt under test used.
   */
  judge?: ModelCallInfo;
}

/** A set of cases on one prompt, run by `npm run eval -- --suite <name>`. */
export interface EvalSuite<TCase extends EvalCase = EvalCase, TOutput = unknown> {
  name: string;
  /** Absolute path of the JSONL file with the cases. */
  casesFile: string;
  caseSchema: z.ZodType<TCase, unknown>;
  /** Calls the real model for a case through the same code the app uses. */
  run(testCase: TCase, openAi: OpenAiService): Promise<SuiteRun<TOutput>>;
  /** Scores every field of the case; `null` is output that did not match the schema. */
  score(testCase: TCase, output: TOutput | null): FieldScore[];
}

export enum RunErrorKind {
  /** The model answered with output that does not match the schema: a failure of the prompt. */
  InvalidOutput = 'invalid_output',
  /** The call itself failed (timeout, rate limit, 5xx): says nothing about the prompt. */
  CallFailed = 'call_failed',
}

export interface RunError {
  kind: RunErrorKind;
  message: string;
}

/**
 * A run of a case: passes when every scored field passes. A failed call is left out of the rates,
 * latency and the baseline; invalid output fails every field of the case.
 */
export interface CaseResult {
  id: string;
  /** 1-based run of the case (`--repeat`). */
  attempt: number;
  tags: string[];
  pass: boolean;
  fields: FieldScore[];
  output: unknown;
  error: RunError | null;
  /** Null when the call failed before the model answered. */
  modelId: string | null;
  latencyMs: number;
  usage: ModelUsage;
  /** Of the judge call too; null when the price of a model is unknown. */
  costUsd: number | null;
  /** What the suite measured (`SuiteRun.metrics`); empty when the output did not come. */
  metrics: Record<string, number>;
}

export interface Rate {
  total: number;
  passed: number;
  rate: number;
}

export interface LatencyStats {
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface MetricStats {
  /** Runs that measured the metric. */
  runs: number;
  mean: number;
  max: number;
}

export interface SuiteSummary {
  suite: string;
  models: string[];
  /** Runs of the cases (cases x `--repeat`) whose call did not fail. */
  cases: Rate;
  /** Runs whose call failed; not in the rates. */
  failedCalls: number;
  /** Runs whose output did not match the schema; failed in the rates. */
  invalidOutputs: number;
  fields: Record<string, Rate>;
  tags: Record<string, Rate>;
  /** Of the runs that measured each metric. */
  metrics: Record<string, MetricStats>;
  usage: ModelUsage;
  /** Of the runs whose call did not fail. */
  latency: LatencyStats;
  /** Null when the price of a model that answered is unknown. */
  costUsd: number | null;
}
