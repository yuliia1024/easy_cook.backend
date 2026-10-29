import { Injectable, Logger } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import {
  ASSISTANT_INVALID_OUTPUT_REPLY,
  ASSISTANT_UNAVAILABLE_REPLY,
  CLARIFICATION_REPLY,
  ChatErrorCode,
  ChatResponseType,
  ChatStreamEventType,
  daysOutOfRangeReply,
  INTERNAL_ERROR_REPLY,
  Intent,
  OUT_OF_SCOPE_REPLY,
} from '../../../common/constants';
import { IntentResult } from '../../../common/contracts';
import {
  ChatResponse,
  ChatStreamEvent,
  MenuComposition,
  ProfileContext,
} from '../../../common/types';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
} from '../../../common/exceptions';
import { Conversation } from '../../../generated/prisma/client';
import { ConversationService } from '../conversation/conversation.service';
import { GeneralChatService } from '../general-chat/general-chat.service';
import { IntentService } from '../intent/intent.service';
import { MenuPlannerService } from '../menu/menu-planner.service';
import {
  EMPTY_MENU_REQUEST,
  resolveClarification,
  resolveMenuRequest,
  ResolvedMenuRequest,
} from '../menu/menu-request';
import { ProfileContextService } from '../profile-context/profile-context.service';

/**
 * Handles a chat message: saves it, loads the profile once, classifies its intent within the
 * conversation and hands it to the service for that intent; every model call sees the profile. Only the intent picks the route, and every route is a fixed service
 * call; a menu is planned from the request the classifier restated, so a follow-up such as "do it
 * again" keeps the earlier details. The request fields of a menu request or a clarification are
 * merged into the conversation (`resolveMenuRequest`), so an answer to a question is kept, a
 * clarification asks only for what is still missing and is a menu request when nothing is
 * (`resolveClarification`), and too many days are offered as the most a menu can have instead of
 * being cut. The reply is saved once it is complete, with the menu it
 * suggests; a failure becomes an `error` event and is not saved.
 */
@Injectable()
export class ChatOrchestratorService {
  private readonly logger = new Logger(ChatOrchestratorService.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly intentService: IntentService,
    private readonly generalChatService: GeneralChatService,
    private readonly menuPlannerService: MenuPlannerService,
    private readonly profileContextService: ProfileContextService,
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
    return this.reply(conversation, content, abortSignal);
  }

  private async *reply(
    conversation: Conversation,
    content: string,
    abortSignal: AbortSignal | undefined,
  ): AsyncGenerator<ChatStreamEvent> {
    const conversationId = conversation.id;
    let reply = '';
    let menu: MenuComposition | undefined;
    let failed = false;
    try {
      for await (const event of this.route(conversation, content, abortSignal)) {
        if (event.type === ChatStreamEventType.TextDelta) {
          reply += event.content;
        } else if (event.type === ChatStreamEventType.Clarification) {
          reply += event.message;
        } else if (event.type === ChatStreamEventType.MenuReady) {
          menu = event.menu;
        } else if (event.type === ChatStreamEventType.Error) {
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
    yield { type: ChatStreamEventType.Done };
  }

  private async *route(
    conversation: Conversation,
    content: string,
    abortSignal: AbortSignal | undefined,
  ): AsyncGenerator<ChatStreamEvent> {
    const conversationId = conversation.id;
    const profile = await this.profileContextService.find();
    const classified = await this.intentService.classify(conversationId, profile, abortSignal);
    const menuRequest = await this.mergeMenuRequest(conversation, profile, classified);
    const { intent, request } = resolveClarification(classified, menuRequest);
    switch (intent) {
      case Intent.GeneralChat:
        for await (const delta of this.generalChatService.reply(
          conversationId,
          profile,
          abortSignal,
        )) {
          yield { type: ChatStreamEventType.TextDelta, content: delta };
        }
        return;
      // A change is planned again from the restated request until a saved menu can be edited by
      // `target`.
      case Intent.GenerateMenu:
      case Intent.ReviseMenu:
        yield* this.planMenu(request ?? content, menuRequest, profile, abortSignal);
        return;
      case Intent.Clarification:
        yield {
          type: ChatStreamEventType.Clarification,
          message: CLARIFICATION_REPLY,
          missingFields: menuRequest.missingFields,
        };
        return;
      case Intent.OutOfScope:
        yield { type: ChatStreamEventType.TextDelta, content: OUT_OF_SCOPE_REPLY };
        return;
      default: {
        const unknown: never = intent;
        throw new Error(`Unhandled intent "${unknown}"`);
      }
    }
  }

  /** Days out of range are offered as the nearest allowed number instead of being planned. */
  private async *planMenu(
    request: string,
    menuRequest: ResolvedMenuRequest,
    profile: ProfileContext | null,
    abortSignal: AbortSignal | undefined,
  ): AsyncGenerator<ChatStreamEvent> {
    const { daysOutOfRange } = menuRequest;
    if (daysOutOfRange) {
      yield {
        type: ChatStreamEventType.Clarification,
        message: daysOutOfRangeReply(daysOutOfRange.requested, daysOutOfRange.offered),
        missingFields: ['days'],
      };
      return;
    }
    // TODO: add sort of stream text until get the menu
    yield* this.toEvents(await this.menuPlannerService.plan(request, profile, abortSignal));
  }

  /**
   * Resolves the request with the one the chat gathered and keeps the result when it changed. Only
   * a menu request brings new fields; any other intent reads what the chat gathered, unchanged.
   */
  private async mergeMenuRequest(
    conversation: Conversation,
    profile: ProfileContext | null,
    { intent, menuRequest }: IntentResult,
  ): Promise<ResolvedMenuRequest> {
    const isMenuRequest = intent === Intent.GenerateMenu || intent === Intent.ReviseMenu;
    const stored = this.conversationService.getMenuRequest(conversation);
    const resolved = resolveMenuRequest(profile, stored, isMenuRequest ? menuRequest : null);
    if (!isDeepStrictEqual(resolved.chat, stored ?? EMPTY_MENU_REQUEST)) {
      await this.conversationService.saveMenuRequest(conversation.id, resolved.chat);
    }
    return resolved;
  }

  /** A menu comes with its message as text, so the message is saved with the reply. */
  private toEvents(response: ChatResponse): ChatStreamEvent[] {
    switch (response.type) {
      case ChatResponseType.Text:
        return [{ type: ChatStreamEventType.TextDelta, content: response.message }];
      case ChatResponseType.MenuReady:
        return [
          { type: ChatStreamEventType.TextDelta, content: response.message },
          { type: ChatStreamEventType.MenuReady, menu: response.menu },
        ];
      case ChatResponseType.Clarification:
        return [
          {
            type: ChatStreamEventType.Clarification,
            message: response.message,
            missingFields: response.missingFields,
          },
        ];
      case ChatResponseType.Error:
        return [
          {
            type: ChatStreamEventType.Error,
            code: response.code,
            message: response.message,
            retryable: response.retryable,
          },
        ];
      default: {
        const unknown: never = response;
        throw new Error(`Unhandled response "${JSON.stringify(unknown)}"`);
      }
    }
  }

  /** What the client learns about a failure: a code and a fixed text, never the error itself. */
  private errorEvent(error: unknown): ChatStreamEvent {
    if (error instanceof AssistantUnavailableException) {
      return this.assistantUnavailable(error.retryable);
    }
    if (error instanceof AssistantInvalidOutputException) {
      return {
        type: ChatStreamEventType.Error,
        code: ChatErrorCode.AssistantInvalidOutput,
        message: ASSISTANT_INVALID_OUTPUT_REPLY,
        retryable: true,
      };
    }
    this.logger.error('Chat reply failed', error instanceof Error ? error.stack : String(error));
    return {
      type: ChatStreamEventType.Error,
      code: ChatErrorCode.InternalError,
      message: INTERNAL_ERROR_REPLY,
      retryable: false,
    };
  }

  private assistantUnavailable(retryable: boolean): ChatStreamEvent {
    return {
      type: ChatStreamEventType.Error,
      code: ChatErrorCode.AssistantUnavailable,
      message: ASSISTANT_UNAVAILABLE_REPLY,
      retryable,
    };
  }
}
