import { join } from 'node:path';
import { z } from 'zod';
import {
  CalculationMode,
  Goal,
  Intent,
  MESSAGE_MAX_LENGTH,
  MessageRole,
} from '../../../src/common/constants';
import { IntentResult } from '../../../src/common/contracts';
import { ProfileContext } from '../../../src/common/types';
import { intentModelCall } from '../../../src/modules/services/intent/intent.service';
import { ModelResult, OpenAiService } from '../../../src/providers/open-ai/open-ai.service';
import { EvalCaseSchema, EvalSuite, FieldScore } from '../../lib/types';

/** Profiles a case can run with; `basic` when the case names none. */
export const INTENT_PROFILES: Record<string, ProfileContext | null> = {
  none: null,
  basic: {
    profileId: 'eval-profile',
    goal: Goal.Maintain,
    nutritionGoal: {
      goalId: 'eval-goal',
      caloriesKcal: 2000,
      proteinG: 120,
      fatG: 70,
      carbsG: 220,
      calculationMode: CalculationMode.RuleBased,
      ruleVersion: null,
    },
    rules: { diets: [], allergies: [], excludedIngredients: [], dislikedFoods: [] },
  },
  vegetarian: {
    profileId: 'eval-profile',
    goal: Goal.LoseWeight,
    nutritionGoal: {
      goalId: 'eval-goal',
      caloriesKcal: 1600,
      proteinG: 100,
      fatG: 55,
      carbsG: 170,
      calculationMode: CalculationMode.RuleBased,
      ruleVersion: null,
    },
    rules: {
      diets: ['vegetarian'],
      allergies: ['peanuts'],
      excludedIngredients: [],
      dislikedFoods: ['mushrooms'],
    },
  },
};

/**
 * A message history, the latest user message last, and what the classifier must return.
 * `days` (null: the user gave none, so the model must not add one) and `constraints` are scored
 * only when set. Each constraint is a list of alternatives, one of which the request must name:
 * `"vegetarian"` named as wanted, `"!meat"` named as excluded ("without meat", "meat-free").
 */
export const IntentCaseSchema = EvalCaseSchema.extend({
  profile: z.enum(Object.keys(INTENT_PROFILES) as [string, ...string[]]).default('basic'),
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
  expected: z.object({
    intent: z.enum(Intent),
    days: z.number().int().positive().nullable().optional(),
    constraints: z
      .array(z.array(z.string().regex(/^!?[^!\s]/)).min(1))
      .min(1)
      .optional(),
  }),
});

export type IntentCase = z.infer<typeof IntentCaseSchema>;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  single: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
};
const NUMBER = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).join('|')})`;

/**
 * `<number> <unit>` (`3-day`, `two weeks`) or `for a <unit>`: a bare "a day" is a rate
 * ("1800 kcal a day"), not the length of the menu.
 */
function countOf(text: string, unit: string): number | null {
  const match = new RegExp(`\\b(?:for (a)|${NUMBER})[\\s-]*${unit}s?\\b`).exec(text);
  if (!match) {
    return null;
  }
  return match[1] ? 1 : (NUMBER_WORDS[match[2]] ?? Number(match[2]));
}

/**
 * The number of days the restated request names (`3-day`, `two weeks`, `for tomorrow`), or null.
 * The classifier returns the request as free text until it returns the days as a field (CHAT-1).
 */
export function parseDays(request: string | null): number | null {
  if (!request) {
    return null;
  }
  const text = request.toLowerCase();
  const days = countOf(text, 'day');
  if (days !== null) {
    return days;
  }
  const weeks = countOf(text, 'week');
  if (weeks !== null) {
    return weeks * 7;
  }
  const months = countOf(text, 'month');
  if (months !== null) {
    return months * 30;
  }
  if (/\b(weekly|week-long)\b/.test(text)) {
    return 7;
  }
  if (/\bweekend\b/.test(text)) {
    return 2;
  }
  if (/\b(today|tomorrow|daily)\b/.test(text)) {
    return 1;
  }
  return null;
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Text before a term that excludes it: a negation, then at most a modifier ("without added
 * sugar") and a list of other items ("no fish, dairy or nuts").
 */
const NEGATED_BEFORE =
  /\b(?:no|not|non|without|excluding|exclude|avoid|avoiding|free of|free from)[\s-]+(?:[\w'-]+\s+)?(?:[\w'-]+(?:\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or|nor)\s+)){0,3}$/;
const FREE_AFTER = /^[\s-]free\b/;

/** Whether the text names `term` (a word starting with it) as wanted, or as excluded. */
export function mentions(text: string, term: string, excluded: boolean): boolean {
  const lower = text.toLowerCase();
  for (const match of lower.matchAll(new RegExp(`\\b${escape(term.toLowerCase())}[\\w]*`, 'g'))) {
    const before = lower.slice(0, match.index);
    const after = lower.slice(match.index + match[0].length);
    const negated = NEGATED_BEFORE.test(before) || FREE_AFTER.test(after);
    if (negated === excluded) {
      return true;
    }
  }
  return false;
}

/** Output that did not match the schema (`null`) fails every field the case scores. */
export function scoreIntent(testCase: IntentCase, output: IntentResult | null): FieldScore[] {
  const { expected } = testCase;
  const request = output?.request ?? null;
  const scores: FieldScore[] = [
    {
      field: 'intent',
      pass: output?.intent === expected.intent,
      expected: expected.intent,
      actual: output?.intent ?? null,
    },
  ];

  if (expected.days !== undefined) {
    const days = parseDays(request);
    scores.push({
      field: 'days',
      pass: output !== null && days === expected.days,
      expected: expected.days,
      actual: days,
    });
  }

  if (expected.constraints) {
    const named = expected.constraints.every((alternatives) =>
      alternatives.some((term) =>
        term.startsWith('!')
          ? mentions(request ?? '', term.slice(1), true)
          : mentions(request ?? '', term, false),
      ),
    );
    scores.push({
      field: 'constraints',
      pass: named,
      expected: expected.constraints,
      actual: request,
    });
  }
  return scores;
}

/** The intent classifier (`IntentService`): intent, days and constraints of a menu request. */
export const intentSuite: EvalSuite<IntentCase, IntentResult> = {
  name: 'intent',
  casesFile: join(__dirname, 'cases.jsonl'),
  caseSchema: IntentCaseSchema,
  run: (testCase: IntentCase, openAi: OpenAiService): Promise<ModelResult<IntentResult>> => {
    const { input, schema, options } = intentModelCall(
      INTENT_PROFILES[testCase.profile],
      testCase.messages,
    );
    return openAi.generateStructuredResult(input, schema, options);
  },
  score: scoreIntent,
};
