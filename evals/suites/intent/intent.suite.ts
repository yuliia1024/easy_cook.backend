import { join } from 'node:path';
import { z } from 'zod';
import {
  CalculationMode,
  Goal,
  Intent,
  INTENT_PROMPT,
  MealType,
  MenuTargetScope,
  MESSAGE_MAX_LENGTH,
  MessageRole,
} from '../../../src/common/constants';
import { IntentResult, MenuTarget } from '../../../src/common/contracts';
import { ProfileContext } from '../../../src/common/types';
import {
  intentModelCall,
  resolveIntent,
} from '../../../src/modules/services/intent/intent.service';
import { ModelResult, OpenAiService } from '../../../src/providers/open-ai/open-ai.service';
import { readTargets } from '../../../src/modules/services/menu/menu-target';
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
 * `days` (`menuRequest.days`; null: the user gave none, so the model must not add one),
 * `constraints` and `targets` are scored only when set. Each constraint is a list of alternatives,
 * one of which the restated request must name: `"vegetarian"` named as wanted, `"!meat"` named as
 * excluded ("without meat", "meat-free"). `targets` scores every target, in any order, by its
 * scope and the fields it sets (`sameTargets`), as the app reads them on the menu of `menuDays`
 * days in the history (`readTargets`) when the case gives it.
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
  menuDays: z.number().int().positive().optional(),
  expected: z.object({
    intent: z.enum(Intent),
    days: z.number().int().positive().nullable().optional(),
    constraints: z
      .array(z.array(z.string().regex(/^!?[^!\s]/)).min(1))
      .min(1)
      .optional(),
    targets: z
      .array(
        z.object({
          scope: z.enum(MenuTargetScope),
          dayIndex: z.number().int().nonnegative().nullable().optional(),
          mealType: z.enum(MealType).nullable().optional(),
        }),
      )
      .min(1)
      .optional(),
  }),
});

export type IntentCase = z.infer<typeof IntentCaseSchema>;

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

/**
 * Whether the targets are the expected ones in any order, one for each: the scope and the fields
 * each expected target sets.
 */
export function sameTargets(
  expected: NonNullable<IntentCase['expected']['targets']>,
  actual: MenuTarget[],
): boolean {
  const left = [...actual];
  return (
    expected.length === actual.length &&
    expected.every((wanted) => {
      const i = left.findIndex((target) =>
        Object.entries(wanted).every(([key, value]) => target[key as keyof MenuTarget] === value),
      );
      return i >= 0 && left.splice(i, 1).length === 1;
    })
  );
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
    const days = output?.menuRequest?.days ?? null;
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
  if (expected.targets) {
    const given = output?.targets ?? null;
    const targets = given && testCase.menuDays ? readTargets(given, testCase.menuDays) : given;
    scores.push({
      field: 'target',
      pass: targets !== null && sameTargets(expected.targets, targets),
      expected: expected.targets,
      actual: targets,
    });
  }
  return scores;
}

/** The intent classifier (`IntentService`): intent, days, constraints and targets of a menu request. */
export const intentSuite: EvalSuite<IntentCase, IntentResult> = {
  name: 'intent',
  casesFile: join(__dirname, 'cases.jsonl'),
  caseSchema: IntentCaseSchema,
  prompts: [INTENT_PROMPT],
  run: async (testCase: IntentCase, openAi: OpenAiService): Promise<ModelResult<IntentResult>> => {
    const { input, schema, options } = intentModelCall(
      INTENT_PROFILES[testCase.profile],
      testCase.messages,
    );
    const result = await openAi.generateStructuredResult(input, schema, options);
    return { ...result, output: resolveIntent(result.output, testCase.messages) };
  },
  score: scoreIntent,
};
