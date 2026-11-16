import { Logger } from '@nestjs/common';
import { join } from 'node:path';
import { z } from 'zod';
import {
  CalculationMode,
  ChatToolErrorCode,
  ChatToolName,
  GENERAL_CHAT_PROMPT,
  Goal,
  MESSAGE_MAX_LENGTH,
  MessageRole,
} from '../../../src/common/constants';
import { PreferenceChangeSchema } from '../../../src/common/contracts';
import { ChatServiceCall, ProfileContext } from '../../../src/common/types';
import {
  ChatToolCall,
  ChatToolRun,
} from '../../../src/modules/services/chat-tools/chat-tool-registry';
import { generalChatModelCall } from '../../../src/modules/services/general-chat/general-chat.service';
import { OpenAiService } from '../../../src/providers/open-ai/open-ai.service';
import { EvalCaseSchema, EvalSuite, FieldScore, SuiteRun } from '../../lib/types';
import { CATALOG_CONVERSATION_ID, catalogChatTools } from './catalog';

const NO_RULES: ProfileContext['rules'] = {
  diets: [],
  allergies: [],
  excludedIngredients: [],
  dislikedFoods: [],
};

const BASIC: ProfileContext = {
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
  rules: NO_RULES,
};

/** Profiles a case can run with; `basic` when the case names none. */
export const CHAT_TOOLS_PROFILES: Record<string, ProfileContext | null> = {
  none: null,
  basic: BASIC,
  vegetarian: { ...BASIC, rules: { ...NO_RULES, diets: ['vegetarian'] } },
  peanut: { ...BASIC, rules: { ...NO_RULES, allergies: ['peanut'] } },
};

const SERVICE_CALLS = [ChatToolName.PlanMenu, ChatToolName.ReviseMenu] as const;

/**
 * A conversation that reaches the chat model, the latest user message last, and what the model
 * must do with its tools. `serviceCall` is the menu tool it must call, or null for none. The rest
 * is scored only when set: `tools`, each called at least once with valid arguments and a result;
 * `noTools`, no tool at all; `forbiddenTools`, none of these, e.g. no `save_menu` for praise of a menu; `days`, `menuRequest.days` of the menu tool (null: the user named
 * none); `mentions`, the reply names one of each list (case-insensitive); `excludes`, it names none
 * of them, e.g. a recipe the profile does not allow.
 */
export const ChatToolsCaseSchema = EvalCaseSchema.extend({
  profile: z.enum(Object.keys(CHAT_TOOLS_PROFILES) as [string, ...string[]]).default('basic'),
  messages: z
    .array(
      z.object({
        role: z.enum(MessageRole),
        content: z
          .string()
          .min(1)
          .max(MESSAGE_MAX_LENGTH * 4),
        /** The change an assistant reply proposed, as the app saves it with the reply. */
        preferenceChange: PreferenceChangeSchema.optional(),
      }),
    )
    .min(1)
    .refine((messages) => messages.at(-1)?.role === MessageRole.User, {
      message: 'the latest message must be from the user',
    }),
  expected: z.object({
    serviceCall: z.enum(SERVICE_CALLS).nullable(),
    tools: z.array(z.enum(ChatToolName)).min(1).optional(),
    noTools: z.literal(true).optional(),
    forbiddenTools: z.array(z.enum(ChatToolName)).min(1).optional(),
    days: z.number().int().positive().nullable().optional(),
    mentions: z
      .array(z.array(z.string().min(1)).min(1))
      .min(1)
      .optional(),
    excludes: z.array(z.string().min(1)).min(1).optional(),
  }),
});

export type ChatToolsCase = z.infer<typeof ChatToolsCaseSchema>;

/** The reply text, every tool call of the loop and the menu tool that ended it. */
export interface ChatToolsOutput {
  reply: string;
  calls: ChatToolCall[];
  serviceCall: ChatServiceCall | null;
}

const names = (text: string, term: string): boolean =>
  text.toLowerCase().includes(term.toLowerCase());

/** Output that did not come (`null`) fails every field the case scores. */
export function scoreChatTools(
  testCase: ChatToolsCase,
  output: ChatToolsOutput | null,
): FieldScore[] {
  const { expected } = testCase;
  const serviceCall = output?.serviceCall?.name ?? null;
  const scores: FieldScore[] = [
    {
      field: 'serviceCall',
      pass: output !== null && serviceCall === expected.serviceCall,
      expected: expected.serviceCall,
      actual: serviceCall,
    },
  ];
  const calls = output?.calls ?? [];
  const called = calls.map(({ name, input, error }) => ({ name, input, error }));
  if (expected.tools) {
    const succeeded = calls.filter(({ error }) => error === null).map(({ name }) => name);
    scores.push({
      field: 'tools',
      pass: output !== null && expected.tools.every((tool) => succeeded.includes(tool)),
      expected: expected.tools,
      actual: called,
    });
  }
  if (expected.noTools) {
    scores.push({
      field: 'noTools',
      pass: output !== null && calls.length === 0,
      expected: [],
      actual: called,
    });
  }
  if (expected.forbiddenTools) {
    const forbidden = expected.forbiddenTools;
    scores.push({
      field: 'forbiddenTools',
      pass: output !== null && !calls.some(({ name }) => forbidden.includes(name as ChatToolName)),
      expected: forbidden,
      actual: called,
    });
  }
  if (expected.days !== undefined) {
    const days = output?.serviceCall?.input.menuRequest.days ?? null;
    scores.push({
      field: 'days',
      pass: output?.serviceCall != null && days === expected.days,
      expected: expected.days,
      actual: days,
    });
  }
  const reply = output?.reply ?? '';
  if (expected.mentions) {
    scores.push({
      field: 'mentions',
      pass:
        output !== null &&
        expected.mentions.every((alternatives) => alternatives.some((term) => names(reply, term))),
      expected: expected.mentions,
      actual: reply,
    });
  }
  if (expected.excludes) {
    scores.push({
      field: 'excludes',
      pass: output !== null && !expected.excludes.some((term) => names(reply, term)),
      expected: expected.excludes,
      actual: reply,
    });
  }
  return scores;
}

/** Runs the chat call of the app (`generalChatModelCall`) on the catalog of the evals. */
export async function runChatTools(
  testCase: ChatToolsCase,
  openAi: OpenAiService,
): Promise<SuiteRun<ChatToolsOutput>> {
  const profile = CHAT_TOOLS_PROFILES[testCase.profile];
  const run = new ChatToolRun();
  const { input, options } = generalChatModelCall(
    profile,
    { summary: null, messages: testCase.messages },
    null,
    catalogChatTools().tools(profile, CATALOG_CONVERSATION_ID),
    run,
    new Logger('chat-tools-eval'),
  );
  const result = await openAi.generateWithToolsResult(input, options);
  return {
    ...result,
    output: { reply: result.output, calls: run.calls, serviceCall: run.serviceCall },
    metrics: {
      toolCalls: run.calls.length,
      invalidArguments: run.calls.filter(
        ({ error }) => error === ChatToolErrorCode.InvalidArguments,
      ).length,
    },
  };
}

/**
 * The chat model with tools (`GeneralChatService`): whether it reads the recipes and the nutrition
 * through the tools, answers with their numbers, calls a menu tool exactly when it should, and
 * saves the menu (`save_menu`) for a command or a yes to the save question, never for praise or a
 * question about it.
 */
export const chatToolsSuite: EvalSuite<ChatToolsCase, ChatToolsOutput> = {
  name: 'chat-tools',
  casesFile: join(__dirname, 'cases.jsonl'),
  caseSchema: ChatToolsCaseSchema,
  prompts: [GENERAL_CHAT_PROMPT],
  run: runChatTools,
  score: scoreChatTools,
};
