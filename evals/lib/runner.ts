import { AssistantInvalidOutputException } from '../../src/common/exceptions';
import { ModelCallInfo } from '../../src/common/types';
import { OpenAiService } from '../../src/providers/open-ai/open-ai.service';
import { costUsd } from './pricing';
import { CaseResult, EvalCase, EvalSuite, RunErrorKind } from './types';

const NO_USAGE = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };

/** Maps `items` with at most `limit` calls in flight; results keep the order of `items`. */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** `cost` with that of the judge call, null when either is unknown. */
function withJudge(cost: number | null, judge: ModelCallInfo | undefined): number | null {
  if (!judge || cost === null) {
    return cost;
  }
  const judged = costUsd(judge.modelId, judge.usage);
  return judged === null ? null : cost + judged;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error);

/**
 * Runs one case and never throws. Output that does not match the schema fails every field and
 * keeps the model and tokens of the answer; any other failure is a failed call.
 */
export async function runCase<TCase extends EvalCase, TOutput>(
  suite: EvalSuite<TCase, TOutput>,
  testCase: TCase,
  openAi: OpenAiService,
  attempt = 1,
): Promise<CaseResult> {
  const startedAt = Date.now();
  const base = { id: testCase.id, attempt, tags: testCase.tags };
  try {
    const result = await suite.run(testCase, openAi);
    const fields = suite.score(testCase, result.output);
    return {
      ...base,
      pass: fields.every((field) => field.pass),
      fields,
      output: result.output,
      error: null,
      modelId: result.modelId,
      latencyMs: result.latencyMs,
      usage: result.usage,
      costUsd: withJudge(costUsd(result.modelId, result.usage), result.judge),
      metrics: result.metrics ?? {},
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    if (error instanceof AssistantInvalidOutputException) {
      return {
        ...base,
        pass: false,
        fields: suite.score(testCase, null).map((field) => ({ ...field, pass: false })),
        output: null,
        error: { kind: RunErrorKind.InvalidOutput, message: errorMessage(error) },
        modelId: error.call?.modelId ?? null,
        latencyMs,
        usage: error.call?.usage ?? NO_USAGE,
        costUsd: error.call ? costUsd(error.call.modelId, error.call.usage) : null,
        metrics: {},
      };
    }
    return {
      ...base,
      pass: false,
      fields: [],
      output: null,
      error: { kind: RunErrorKind.CallFailed, message: errorMessage(error) },
      modelId: null,
      latencyMs,
      usage: NO_USAGE,
      costUsd: 0,
      metrics: {},
    };
  }
}

/** Runs every case `repeat` times; results are ordered by attempt, then by case. */
export function runSuite<TCase extends EvalCase, TOutput>(
  suite: EvalSuite<TCase, TOutput>,
  cases: TCase[],
  openAi: OpenAiService,
  { concurrency, repeat }: { concurrency: number; repeat: number },
): Promise<CaseResult[]> {
  const runs = Array.from({ length: repeat }, (_, i) =>
    cases.map((testCase) => ({ testCase, attempt: i + 1 })),
  ).flat();
  return mapConcurrent(runs, concurrency, ({ testCase, attempt }) =>
    runCase(suite, testCase, openAi, attempt),
  );
}
