import { z } from 'zod';
import { CaseResult, EvalCaseSchema, EvalSuite, FieldScore } from '../lib/types';

/** A finished run for the specs; passes with one passing `intent` field by default. */
export function buildCaseResult(overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    id: 'case-1',
    attempt: 1,
    tags: [],
    pass: true,
    fields: [{ field: 'intent', pass: true, expected: 'a', actual: 'a' }],
    output: { intent: 'a' },
    error: null,
    modelId: 'gpt-4o-mini-2024-07-18',
    latencyMs: 100,
    usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 10 },
    costUsd: 0.001,
    metrics: {},
    ...overrides,
  };
}

export const EchoCaseSchema = EvalCaseSchema.extend({ answer: z.string() });
export type EchoCase = z.infer<typeof EchoCaseSchema>;

/** A suite whose `run` is a mock; a case passes when the output equals its `answer`. */
export function buildEchoSuite(
  casesFile = '/nowhere/cases.jsonl',
): EvalSuite<EchoCase, string> & { run: jest.Mock } {
  return {
    name: 'echo',
    casesFile,
    caseSchema: EchoCaseSchema,
    prompts: [{ name: 'echo', version: 1, instructions: 'Echo.' }],
    run: jest.fn(),
    score: (testCase: EchoCase, output: string | null): FieldScore[] => [
      {
        field: 'answer',
        pass: output === testCase.answer,
        expected: testCase.answer,
        actual: output,
      },
    ],
  };
}
