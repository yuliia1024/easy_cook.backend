import { join } from 'node:path';
import { z } from 'zod';
import {
  Intent,
  INTENT_PROMPT,
  MENU_MAX_DAYS,
  MENU_MIN_DAYS,
  MENU_REQUEST_REQUIRED_FIELDS,
  MESSAGE_MAX_LENGTH,
  MessageRole,
} from '../../../src/common/constants';
import { MenuRequest, MenuRequestSchema } from '../../../src/common/contracts';
import {
  intentModelCall,
  resolveIntent,
} from '../../../src/modules/services/intent/intent.service';
import {
  EMPTY_MENU_REQUEST,
  MenuClarification,
  menuClarification,
  resolveClarification,
  resolveMenuRequest,
} from '../../../src/modules/services/menu/menu-request';
import { LlmService } from '../../../src/providers/llm/llm.service';
import { judgePrompt, JudgeVerdict, judgeScores, loadRubric, runJudge } from '../../lib/judge';
import { EvalCaseSchema, EvalSuite, FieldScore, SuiteRun } from '../../lib/types';
import { INTENT_PROFILES } from '../intent/intent.suite';

export const CLARIFICATION_CRITERIA = [
  'asks_for_missing',
  'no_repeat',
  'clear',
  'consistent',
] as const;

export type ClarificationCriterion = (typeof CLARIFICATION_CRITERIA)[number];

/** What the judge grades a question by: `rubric.md`, one section per criterion. */
export const CLARIFICATION_RUBRIC = loadRubric(
  join(__dirname, 'rubric.md'),
  CLARIFICATION_CRITERIA,
);

/**
 * A conversation, the latest user message last, with the menu request the chat gathered before
 * it (`chat`, the fields it has), and whether the app must ask a question instead of answering.
 * `missingFields` (what the question is about) is scored only when set, and only with
 * `clarification`; the judge grades the question of every case that expects one.
 */
export const ClarificationCaseSchema = EvalCaseSchema.extend({
  profile: z.enum(Object.keys(INTENT_PROFILES) as [string, ...string[]]).default('basic'),
  chat: MenuRequestSchema.partial().nullable().default(null),
  messages: z
    .array(
      z.object({
        role: z.enum(MessageRole),
        content: z.string().min(1).max(MESSAGE_MAX_LENGTH),
      }),
    )
    .min(1)
    .refine((messages) => messages.at(-1)?.role === MessageRole.User, {
      message: 'the latest message must be from the user',
    }),
  expected: z
    .object({
      clarification: z.boolean(),
      missingFields: z.array(z.enum(MENU_REQUEST_REQUIRED_FIELDS)).optional(),
    })
    .refine(({ clarification, missingFields }) => clarification || !missingFields, {
      message: 'missingFields only with a clarification',
    }),
});

export type ClarificationCase = z.infer<typeof ClarificationCaseSchema>;

export interface ClarificationOutput {
  /** After `resolveClarification`, as the chat routes it. */
  intent: Intent;
  clarification: MenuClarification | null;
  /** The menu request the app has: the profile, the chat and the message. */
  known: MenuRequest;
  /** Null when there was no question to grade. */
  verdict: JudgeVerdict<ClarificationCriterion> | null;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((item) => b.includes(item));

/**
 * `clarification`: a question was asked exactly when expected; `missingFields`: it is about
 * these fields; `judge.<criterion>`: the judge passed the question on the rubric. Output that did
 * not match the schema (`null`) fails every field.
 */
export function scoreClarification(
  testCase: ClarificationCase,
  output: ClarificationOutput | null,
): FieldScore[] {
  const { expected } = testCase;
  const asked = output?.clarification ?? null;
  const scores: FieldScore[] = [
    {
      field: 'clarification',
      pass: output !== null && (asked !== null) === expected.clarification,
      expected: expected.clarification,
      actual: asked?.message ?? output?.intent ?? null,
    },
  ];
  if (expected.missingFields) {
    scores.push({
      field: 'missingFields',
      pass: asked !== null && sameSet(asked.missingFields, expected.missingFields),
      expected: expected.missingFields,
      actual: asked?.missingFields ?? null,
    });
  }
  if (expected.clarification) {
    scores.push(...judgeScores(CLARIFICATION_RUBRIC, output?.verdict ?? null));
  }
  return scores;
}

/**
 * Answers the case like `ChatOrchestratorService`: the classifier (`intentModelCall`,
 * `resolveIntent`), the menu request gathered with the profile and the chat
 * (`resolveMenuRequest`), `resolveClarification` and the question (`menuClarification`). A
 * question the case expects goes to the judge; the judge's cost is in the case's, its tokens and
 * time are not. A judge that fails is a failed call: it says nothing about the prompt.
 */
export async function runClarification(
  testCase: ClarificationCase,
  llm: LlmService,
): Promise<SuiteRun<ClarificationOutput>> {
  const profile = INTENT_PROFILES[testCase.profile];
  const chat = testCase.chat ? { ...EMPTY_MENU_REQUEST, ...testCase.chat } : null;
  const { input, schema, options } = intentModelCall(profile, testCase.messages, undefined, {
    menuRequest: chat,
    summary: null,
  });
  const result = await llm.generateStructuredResult(input, schema, options);
  const classified = resolveIntent(result.output, testCase.messages);
  const isMenuRequest =
    classified.intent === Intent.GenerateMenu || classified.intent === Intent.ReviseMenu;
  const resolved = resolveMenuRequest(
    profile,
    chat,
    isMenuRequest ? classified.menuRequest : null,
    { revision: classified.intent === Intent.ReviseMenu },
  );
  const { intent } = resolveClarification(classified, resolved);
  const clarification = menuClarification(intent, resolved);
  const output: ClarificationOutput = {
    intent,
    clarification,
    known: resolved.request,
    verdict: null,
  };
  const call = { modelId: result.modelId, latencyMs: result.latencyMs, usage: result.usage };
  if (!clarification || !testCase.expected.clarification) {
    return { ...call, output };
  }
  try {
    const judged = await runJudge(llm, CLARIFICATION_RUBRIC, {
      conversation: testCase.messages,
      known: resolved.request,
      missingFields: clarification.missingFields,
      limits: { minDays: MENU_MIN_DAYS, maxDays: MENU_MAX_DAYS },
      reply: clarification.message,
    });
    return {
      ...call,
      output: { ...output, verdict: judged.output },
      judge: { modelId: judged.modelId, usage: judged.usage },
    };
  } catch (error) {
    throw new Error(`The judge failed: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

/**
 * The questions the chat asks instead of planning: whether it asks, about which fields, and how
 * good the question is (LLM-as-judge on `rubric.md`).
 */
export const clarificationSuite: EvalSuite<ClarificationCase, ClarificationOutput> = {
  name: 'clarification',
  casesFile: join(__dirname, 'cases.jsonl'),
  caseSchema: ClarificationCaseSchema,
  prompts: [INTENT_PROMPT, judgePrompt(CLARIFICATION_RUBRIC)],
  run: runClarification,
  score: scoreClarification,
};
