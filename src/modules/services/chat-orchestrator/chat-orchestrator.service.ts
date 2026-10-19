import { Injectable, Logger } from '@nestjs/common';
import {
  ASSISTANT_INVALID_OUTPUT_REPLY,
  ASSISTANT_UNAVAILABLE_REPLY,
  CLARIFICATION_MISSING_FIELDS,
  CLARIFICATION_REPLY,
  ChatErrorCode,
  INTERNAL_ERROR_REPLY,
  Intent,
  OUT_OF_SCOPE_REPLY,
} from '../../../common/constants';
import { ChatResponse, ChatStreamEvent } from '../../../common/contracts';
import { MenuComposition } from '../../../common/types';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
} from '../../../common/exceptions';
import { ConversationService } from '../conversation/conversation.service';
import { GeneralChatService } from '../general-chat/general-chat.service';
import { IntentService } from '../intent/intent.service';
import { MenuPlannerService } from '../menu/menu-planner.service';

/**
 * Handles a chat message: saves it, classifies its intent and hands it to the service for that
 * intent. Only the intent picks the route, and every route is a fixed service call. The reply is
 * saved once it is complete, with the menu it suggests; a failure becomes an `error` event and is
 * not saved.
 */
@Injectable()
export class ChatOrchestratorService {
  private readonly logger = new Logger(ChatOrchestratorService.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly intentService: IntentService,
    private readonly generalChatService: GeneralChatService,
    private readonly menuPlannerService: MenuPlannerService,
  ) {}

  /**
   * Saves the message and returns the reply as events, ending with `done`. 404 for an unknown
   * conversation comes before the stream. Once `abortSignal` aborts, the stream ends silently.
   */
  public async handleMessage(
    conversationId: string,
    content: string,
    abortSignal?: AbortSignal,
  ): Promise<AsyncGenerator<ChatStreamEvent>> {
    const conversation = await this.conversationService.getById(conversationId);
    await this.conversationService.addUserMessage(conversation, content);
    return this.reply(conversationId, content, abortSignal);
  }

  private async *reply(
    conversationId: string,
    content: string,
    abortSignal: AbortSignal | undefined,
  ): AsyncGenerator<ChatStreamEvent> {
    let reply = '';
    let menu: MenuComposition | undefined;
    let failed = false;
    try {
      for await (const event of this.route(conversationId, content, abortSignal)) {
        if (event.type === 'text_delta') {
          reply += event.content;
        } else if (event.type === 'clarification') {
          reply += event.message;
        } else if (event.type === 'menu_ready') {
          menu = event.menu;
        } else if (event.type === 'error') {
          failed = true;
        }
        yield event;
      }
      if (abortSignal?.aborted) {
        return;
      }
      if (!failed && reply) {
        await this.conversationService.addAssistantMessage(conversationId, reply, menu);
      }
    } catch (error) {
      if (abortSignal?.aborted) {
        return;
      }
      yield this.errorEvent(error);
    }
    yield { type: 'done' };
  }

  private async *route(
    conversationId: string,
    content: string,
    abortSignal: AbortSignal | undefined,
  ): AsyncGenerator<ChatStreamEvent> {
    const { intent } = await this.intentService.classify(content, abortSignal);
    switch (intent) {
      case Intent.GeneralChat:
        for await (const delta of this.generalChatService.reply(conversationId, abortSignal)) {
          yield { type: 'text_delta', content: delta };
        }
        return;
      case Intent.GenerateMenu:
        yield* this.toEvents(await this.menuPlannerService.plan(content, abortSignal));
        return;
      case Intent.Clarification:
        yield {
          type: 'clarification',
          message: CLARIFICATION_REPLY,
          missingFields: CLARIFICATION_MISSING_FIELDS,
        };
        return;
      case Intent.OutOfScope:
        yield { type: 'text_delta', content: OUT_OF_SCOPE_REPLY };
        return;
      default: {
        const unknown: never = intent;
        throw new Error(`Unhandled intent "${unknown}"`);
      }
    }
  }

  /** A menu comes with its message as text, so the message is saved with the reply. */
  private toEvents(response: ChatResponse): ChatStreamEvent[] {
    switch (response.type) {
      case 'text':
        return [{ type: 'text_delta', content: response.message }];
      case 'menu_ready':
        return [
          { type: 'text_delta', content: response.message },
          { type: 'menu_ready', menu: response.menu },
        ];
      default:
        return [response];
    }
  }

  /** What the client learns about a failure: a code and a fixed text, never the error itself. */
  private errorEvent(error: unknown): ChatStreamEvent {
    if (error instanceof AssistantUnavailableException) {
      return this.assistantUnavailable(error.retryable);
    }
    if (error instanceof AssistantInvalidOutputException) {
      return {
        type: 'error',
        code: ChatErrorCode.AssistantInvalidOutput,
        message: ASSISTANT_INVALID_OUTPUT_REPLY,
        retryable: true,
      };
    }
    this.logger.error('Chat reply failed', error instanceof Error ? error.stack : String(error));
    return {
      type: 'error',
      code: ChatErrorCode.InternalError,
      message: INTERNAL_ERROR_REPLY,
      retryable: false,
    };
  }

  private assistantUnavailable(retryable: boolean): ChatStreamEvent {
    return {
      type: 'error',
      code: ChatErrorCode.AssistantUnavailable,
      message: ASSISTANT_UNAVAILABLE_REPLY,
      retryable,
    };
  }
}
