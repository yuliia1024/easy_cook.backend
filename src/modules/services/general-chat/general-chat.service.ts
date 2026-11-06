import { Injectable, Logger } from '@nestjs/common';
import {
  CHAT_TOOL_MAX_STEPS,
  CHAT_TOOL_STATUS,
  ChatStreamEventType,
  GENERAL_CHAT_MAX_OUTPUT_TOKENS,
  GENERAL_CHAT_PROMPT,
} from '../../../common/constants';
import { MenuRequest } from '../../../common/contracts';
import { ChatProgressEvent, ChatServiceCall, ProfileContext } from '../../../common/types';
import { withEvents } from '../../../common/utils';
import {
  ModelInput,
  OpenAiService,
  ToolLoopOptions,
} from '../../../providers/open-ai/open-ai.service';
import {
  ChatTool,
  ChatToolCall,
  ChatToolRun,
  ChatToolRunListener,
  toToolSet,
} from '../chat-tools/chat-tool-registry';
import { ChatToolsService } from '../chat-tools/chat-tools.service';
import { ModelHistory } from '../conversation/conversation.service';
import { ModelHistoryMessage, toModelMessages } from '../conversation/model-messages';
import { profileMessage } from '../profile-context/model-profile';

/** One chat call with tools: the input and the options of the loop. */
export interface GeneralChatModelCall {
  input: ModelInput;
  options: ToolLoopOptions;
}

/**
 * The chat call for the profile, the conversation context and the recent messages, oldest first,
 * with `tools` recording their calls in `run`. The chat-tools evals (`evals/suites/chat-tools`) run
 * the same call, so they measure the prompt, the tools and the loop the chat uses.
 */
export function generalChatModelCall(
  profile: ProfileContext | null,
  history: { summary: string | null; messages: ModelHistoryMessage[] },
  menuRequest: MenuRequest | null,
  tools: ChatTool[],
  run: ChatToolRun,
  logger: Logger,
  abortSignal?: AbortSignal,
): GeneralChatModelCall {
  return {
    input: [
      profileMessage(profile, { menuRequest, summary: history.summary }),
      ...toModelMessages(history.messages),
    ],
    options: {
      prompt: GENERAL_CHAT_PROMPT,
      maxOutputTokens: GENERAL_CHAT_MAX_OUTPUT_TOKENS,
      abortSignal,
      tools: toToolSet(tools, run, logger),
      maxSteps: CHAT_TOOL_MAX_STEPS,
      isDone: () => run.isDone(),
    },
  };
}

/**
 * Talk about meal planning, answered by the model from the recent history, the summary of the
 * older one, the menu request gathered so far and the profile. The model can read recipes and
 * nutrition through the chat tools (`ChatToolsService`), up to `CHAT_TOOL_MAX_STEPS` model calls,
 * and can ask for a menu (`plan_menu`, `revise_menu`): that ends the reply with the service call,
 * which the caller runs.
 */
@Injectable()
export class GeneralChatService {
  private readonly logger = new Logger(GeneralChatService.name);

  constructor(
    private readonly openAiService: OpenAiService,
    private readonly chatToolsService: ChatToolsService,
  ) {}

  /**
   * Streams the reply to the conversation: the text, and a `status` while a tool runs
   * (`CHAT_TOOL_STATUS`), as soon as it starts. The latest message of `history` is the one to
   * answer. `onToolCall` hears every finished tool call (the trace). Returns the service call the
   * model made, or null.
   */
  public async *reply(
    history: ModelHistory,
    menuRequest: MenuRequest | null,
    profile: ProfileContext | null,
    abortSignal?: AbortSignal,
    onToolCall: (call: ChatToolCall) => void = () => undefined,
  ): AsyncGenerator<string | ChatProgressEvent, ChatServiceCall | null> {
    const replies = withEvents<string, ChatProgressEvent, ChatServiceCall | null>((emit) =>
      this.stream(history, menuRequest, profile, abortSignal, {
        onToolStart: (name) => {
          const step = CHAT_TOOL_STATUS[name];
          if (step) {
            emit({ type: ChatStreamEventType.Status, step });
          }
        },
        onToolEnd: onToolCall,
      }),
    );
    for (;;) {
      const next = await replies.next();
      if (next.done === true) {
        return next.value;
      }
      yield next.value.event ?? next.value.value;
    }
  }

  private async *stream(
    history: ModelHistory,
    menuRequest: MenuRequest | null,
    profile: ProfileContext | null,
    abortSignal: AbortSignal | undefined,
    listener: ChatToolRunListener,
  ): AsyncGenerator<string, ChatServiceCall | null> {
    const run = new ChatToolRun(listener);
    const { input, options } = generalChatModelCall(
      profile,
      history,
      menuRequest,
      this.chatToolsService.tools(profile),
      run,
      this.logger,
      abortSignal,
    );
    yield* this.openAiService.streamWithTools(input, options);
    return run.serviceCall;
  }
}
