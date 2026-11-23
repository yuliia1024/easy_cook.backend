import { Injectable } from '@nestjs/common';
import {
  Intent,
  INTENT_PROMPT,
  INTENT_MAX_OUTPUT_TOKENS,
  MenuTargetScope,
  MessageRole,
} from '../../../common/constants';
import {
  IntentResult,
  IntentResultSchema,
  MenuRequest,
  MenuTarget,
} from '../../../common/contracts';
import { ProfileContext } from '../../../common/types';
import { Message } from '../../../generated/prisma/client';
import {
  ModelCallOptions,
  ModelInput,
  LlmService,
} from '../../../providers/llm/llm.service';
import { ModelHistory } from '../conversation/conversation.service';
import { ModelHistoryMessage, toModelMessages } from '../conversation/model-messages';
import {
  EMPTY_CONVERSATION_CONTEXT,
  ModelConversationContext,
  profileMessage,
} from '../profile-context/model-profile';

/** One classifier call: the input, the schema of the answer and the options. */
export interface IntentModelCall {
  input: ModelInput;
  schema: typeof IntentResultSchema;
  options: ModelCallOptions;
}

/**
 * The classifier call for the profile, the conversation context (the menu request and the summary)
 * and the recent messages, oldest first. The intent evals (`evals/suites/intent`) run the same
 * call, so they measure the prompt the chat uses.
 */
export function intentModelCall(
  profile: ProfileContext | null,
  messages: ModelHistoryMessage[],
  abortSignal?: AbortSignal,
  context: ModelConversationContext = EMPTY_CONVERSATION_CONTEXT,
): IntentModelCall {
  return {
    input: [profileMessage(profile, context), ...toModelMessages(messages)],
    schema: IntentResultSchema,
    options: {
      prompt: INTENT_PROMPT,
      maxOutputTokens: INTENT_MAX_OUTPUT_TOKENS,
      abortSignal,
    },
  };
}

/**
 * The scope of the most specific field the model set: it fills them more reliably. A meal without
 * a day stays a change to the whole menu when the model said so ("all dinners").
 */
function withScope(target: MenuTarget): MenuTarget {
  if (target.scope === MenuTargetScope.Menu && target.dayIndex === null) {
    return target;
  }
  const scope =
    target.mealType !== null
      ? MenuTargetScope.Meal
      : target.dayIndex !== null
        ? MenuTargetScope.Day
        : MenuTargetScope.Menu;
  return scope === target.scope ? target : { ...target, scope };
}

/**
 * Applies the rules the model does not follow reliably; the evals apply them too. Only
 * `revise_menu` keeps its targets, the scope of each matching its fields. A revision needs a menu to revise:
 * without an earlier assistant reply it is a new menu when the model restated a request ("a menu
 * for a week, no chicken"), otherwise a clarification ("change my menu somehow").
 */
export function resolveIntent(
  result: IntentResult,
  messages: Pick<Message, 'role'>[],
): IntentResult {
  if (result.intent !== Intent.ReviseMenu) {
    return result.targets ? { ...result, targets: null } : result;
  }
  if (!messages.some((message) => message.role === MessageRole.Assistant)) {
    return result.menuRequest
      ? { ...result, intent: Intent.GenerateMenu, targets: null }
      : {
          intent: Intent.Clarification,
          request: null,
          menuRequest: null,
          targets: null,
          wishOffer: null,
        };
  }
  if (!result.targets) {
    return result;
  }
  const targets = result.targets.map(withScope);
  return targets.every((target, i) => target === result.targets[i])
    ? result
    : { ...result, targets };
}

/**
 * Classifies the latest message of a conversation by the model, which reads the recent history
 * (and the summary of the older one) to understand follow-ups, the menu request gathered so far
 * and the profile to tell whether a request is enough, and restates a menu request on its own. No recipes. Output
 * that does not match the schema (`AssistantInvalidOutputException`) and API failures are
 * rethrown; the chat answers both with a neutral error, never with a guessed intent.
 */
@Injectable()
export class IntentService {
  constructor(private readonly llmService: LlmService) {}

  /** `history` ends with the message to classify. */
  public async classify(
    history: ModelHistory,
    menuRequest: MenuRequest | null,
    profile: ProfileContext | null,
    abortSignal?: AbortSignal,
  ): Promise<IntentResult> {
    const { input, schema, options } = intentModelCall(profile, history.messages, abortSignal, {
      menuRequest,
      summary: history.summary,
    });
    const result = await this.llmService.generateStructured(input, schema, options);
    return resolveIntent(result, history.messages);
  }
}
