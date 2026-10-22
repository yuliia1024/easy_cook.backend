import { z } from 'zod';
import { ModelUsage } from '../../src/common/types';
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

/** A set of cases on one prompt, run by `npm run eval -- --suite <name>`. */
export interface EvalSuite<TCase extends EvalCase = EvalCase, TOutput = unknown> {
  name: string;
  /** Absolute path of the JSONL file with the cases. */
  casesFile: string;
  caseSchema: z.ZodType<TCase, unknown>;
  /** Calls the real model for a case through the same code the app uses. */
  run(testCase: TCase, openAi: OpenAiService): Promise<ModelResult<TOutput>>;
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
  /** Null when the price of the model is unknown. */
  costUsd: number | null;
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
  usage: ModelUsage;
  /** Of the runs whose call did not fail. */
  latency: LatencyStats;
  /** Null when the price of a model that answered is unknown. */
  costUsd: number | null;
}
