import { Injectable, Logger } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import {
  ASSISTANT_INVALID_OUTPUT_REPLY,
  ASSISTANT_UNAVAILABLE_REPLY,
  CONVERSATION_LIMIT_REPLY,
  CONVERSATION_MAX_USER_MESSAGES,
  ChatErrorCode,
  ChatResponseType,
  ChatStatusStep,
  ChatStreamEventType,
  INTERNAL_ERROR_REPLY,
  Intent,
  MENU_PLAN_FAILED_REPLY,
  MenuTargetScope,
  MessageRole,
  OUT_OF_SCOPE_REPLY,
} from '../../../common/constants';
import { IntentResult, MenuTarget } from '../../../common/contracts';
import {
  ChatProgressEvent,
  ChatResponse,
  ChatStreamEvent,
  ProfileContext,
  ResolvedDay,
} from '../../../common/types';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
} from '../../../common/exceptions';
import { withProgress } from '../../../common/utils';
import { Conversation } from '../../../generated/prisma/client';
import { ConversationWithMessages } from '../../data-access/conversation/conversation.repository';
import { ConversationService } from '../conversation/conversation.service';
import { ConversationSummaryService } from '../conversation-summary/conversation-summary.service';
import { GeneralChatService } from '../general-chat/general-chat.service';
import { IntentService } from '../intent/intent.service';
import { MenuPlannerService } from '../menu/menu-planner.service';
import { MenuService } from '../menu/menu.service';
import {
  EMPTY_MENU_REQUEST,
  menuClarification,
  resolveClarification,
  resolveMenuRequest,
  ResolvedMenuRequest,
} from '../menu/menu-request';
import { targetClarification, targetDayIndex } from '../menu/menu-target';
import { ProfileContextService } from '../profile-context/profile-context.service';

/** A change to one day or one meal of the latest menu the chat suggested. */
interface Revision {
  previous: ResolvedDay[];
  target: MenuTarget;
}

/**
 * Handles a chat message: saves it, loads the profile once, classifies its intent within the
 * conversation and hands it to the service for that intent; every model call sees the profile. Only the intent picks the route, and every route is a fixed service
 * call; a menu is planned from the request the classifier restated, so a follow-up such as "do it
 * again" keeps the earlier details. The request fields of a menu request or a clarification are
 * merged into the conversation (`resolveMenuRequest`), so an answer to a question is kept, a
 * clarification asks only for what is still missing and is a menu request when nothing is
 * (`resolveClarification`), and too many days are offered as the most a menu can have instead of
 * being cut. Every planned menu is saved as a draft: the first one of the conversation as a new
 * menu linked to it, the next ones as new versions of that menu. The reply is saved once it is
 * complete, with the menu version it created; a failure becomes an `error` event and is not saved.
 * Progress (`status`, `menu_pending`) is streamed as it happens and is never part of the reply.
 * The model reads the latest messages within a token budget, the summary of the older ones and the
 * gathered menu request; the summary is brought up to date after a saved reply. A conversation that
 * holds `CONVERSATION_MAX_USER_MESSAGES` messages of the user takes no more: the message is not saved and the reply is an error
 * that asks for a new conversation, which can start with the menu request of this one.
 */
@Injectable()
export class ChatOrchestratorService {
  private readonly logger = new Logger(ChatOrchestratorService.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly intentService: IntentService,
    private readonly generalChatService: GeneralChatService,
    private readonly menuPlannerService: MenuPlannerService,
    private readonly menuService: MenuService,
    private readonly profileContextService: ProfileContextService,
    private readonly conversationSummaryService: ConversationSummaryService,
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
    const userMessages = conversation.messages.filter(({ role }) => role === MessageRole.User);
    if (userMessages.length >= CONVERSATION_MAX_USER_MESSAGES) {
      return this.limitReached();
    }
    await this.conversationService.addUserMessage(conversation, content);
    return this.reply(conversation, content, abortSignal);
  }

  private async *limitReached(): AsyncGenerator<ChatStreamEvent> {
    yield {
      type: ChatStreamEventType.Error,
      code: ChatErrorCode.ConversationLimitReached,
      message: CONVERSATION_LIMIT_REPLY,
      retryable: false,
    };
    yield { type: ChatStreamEventType.Done };
  }

  private async *reply(
    conversation: ConversationWithMessages,
    content: string,
    abortSignal: AbortSignal | undefined,
  ): AsyncGenerator<ChatStreamEvent> {
    const conversationId = conversation.id;
    let reply = '';
    let menu: Extract<ChatStreamEvent, { type: ChatStreamEventType.MenuReady }> | undefined;
    let failed = false;
    try {
      for await (const event of this.route(conversation, content, abortSignal)) {
        if (event.type === ChatStreamEventType.TextDelta) {
          reply += event.content;
        } else if (event.type === ChatStreamEventType.Clarification) {
          reply += event.message;
        } else if (event.type === ChatStreamEventType.MenuReady) {
          menu = event;
        } else if (event.type === ChatStreamEventType.Error) {
          failed = true;
        }
        yield event;
      }
      if (abortSignal?.aborted) {
        return;
      }
      if (!failed && reply) {
        await this.conversationService.addAssistantMessage(conversationId, reply, menu?.versionId);
        await this.summarize(conversation, abortSignal);
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
    conversation: ConversationWithMessages,
    content: string,
    abortSignal: AbortSignal | undefined,
  ): AsyncGenerator<ChatStreamEvent> {
    yield { type: ChatStreamEventType.Status, step: ChatStatusStep.Thinking };
    const profile = await this.profileContextService.find();
    const history = await this.conversationService.getModelHistory(conversation);
    const classified = await this.intentService.classify(
      history,
      this.conversationService.getMenuRequest(conversation),
      profile,
      abortSignal,
    );
    const menuRequest = await this.mergeMenuRequest(conversation, profile, classified);
    const { intent, request, target } = resolveClarification(classified, menuRequest);
    const clarification = menuClarification(intent, menuRequest);
    if (clarification) {
      yield { type: ChatStreamEventType.Clarification, ...clarification };
      return;
    }
    switch (intent) {
      case Intent.GeneralChat:
        for await (const delta of this.generalChatService.reply(
          history,
          menuRequest.chat,
          profile,
          abortSignal,
        )) {
          yield { type: ChatStreamEventType.TextDelta, content: delta };
        }
        return;
      // A change to one day or one meal plans only that part again; any other change plans the
      // whole menu again from the restated request.
      case Intent.GenerateMenu:
      case Intent.ReviseMenu:
        yield* this.planMenu(
          conversation,
          request ?? content,
          menuRequest,
          profile,
          abortSignal,
          intent === Intent.ReviseMenu ? target : null,
        );
        return;
      // Asked above (`menuClarification`).
      case Intent.Clarification:
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

  /**
   * A plan still invalid after every attempt of the planner ends with `MENU_PLAN_FAILED_REPLY`. A planned
   * menu is saved as a draft version before it is sent, so the client gets its ids. A revision of
   * one day or one meal of the latest suggested menu (`revisionOf`) changes only that part and
   * keeps the rest; a target the menu cannot pin down is asked about instead (`targetClarification`).
   */
  private async *planMenu(
    conversation: ConversationWithMessages,
    request: string,
    menuRequest: ResolvedMenuRequest,
    profile: ProfileContext | null,
    abortSignal: AbortSignal | undefined,
    target: MenuTarget | null,
  ): AsyncGenerator<ChatStreamEvent> {
    const revision = await this.revisionOf(conversation, target, menuRequest);
    const clarification = revision && targetClarification(revision.target, revision.previous);
    if (clarification) {
      yield { type: ChatStreamEventType.Clarification, ...clarification };
      return;
    }
    let response: ChatResponse;
    try {
      response = yield* withProgress<ChatStreamEvent, ChatResponse>((onProgress) =>
        this.planned(request, menuRequest, profile, revision, abortSignal, onProgress),
      );
    } catch (error) {
      if (!(error instanceof AssistantInvalidOutputException)) {
        throw error;
      }
      response = {
        type: ChatResponseType.Error,
        code: ChatErrorCode.AssistantInvalidOutput,
        message: MENU_PLAN_FAILED_REPLY,
        retryable: true,
      };
    }
    if (response.type === ChatResponseType.MenuReady) {
      const saved = await this.menuService.saveGenerated(conversation, {
        menu: response.menu,
        days: response.days,
        nutritionGoal: profile?.nutritionGoal ?? null,
        generatedWith: response.generatedWith,
      });
      yield { type: ChatStreamEventType.TextDelta, content: response.message };
      yield { type: ChatStreamEventType.MenuReady, ...saved, menu: response.menu };
      return;
    }
    yield* this.toEvents(response);
  }

  /** The day or the meal of the revision planned again, or else the whole menu. */
  private planned(
    request: string,
    menuRequest: ResolvedMenuRequest,
    profile: ProfileContext | null,
    revision: Revision | null,
    abortSignal: AbortSignal | undefined,
    onProgress: (event: ChatProgressEvent) => void,
  ): Promise<ChatResponse> {
    if (revision?.target.scope === MenuTargetScope.Day) {
      return this.menuPlannerService.replanDay(
        request,
        menuRequest.request,
        profile,
        revision.previous,
        revision.target.dayIndex,
        abortSignal,
        onProgress,
      );
    }
    if (revision?.target.scope === MenuTargetScope.Meal) {
      return this.menuPlannerService.replanMeal(
        request,
        menuRequest.request,
        profile,
        revision.previous,
        targetDayIndex(revision.target, revision.previous),
        revision.target.mealType,
        abortSignal,
        onProgress,
      );
    }
    return this.menuPlannerService.plan(
      request,
      menuRequest.request,
      profile,
      abortSignal,
      onProgress,
    );
  }

  /**
   * The latest menu the chat suggested and the day or the meal of it a revision targets, when the
   * request keeps its number of days; null for a change to the whole menu, without a suggested
   * menu or with another number of days, and the whole menu is planned again.
   */
  private async revisionOf(
    conversation: ConversationWithMessages,
    target: MenuTarget | null,
    menuRequest: ResolvedMenuRequest,
  ): Promise<Revision | null> {
    if (!target || target.scope === MenuTargetScope.Menu) {
      return null;
    }
    const versionId = [...conversation.messages]
      .reverse()
      .find(
        (message) => message.role === MessageRole.Assistant && message.menuVersionId,
      )?.menuVersionId;
    if (!versionId) {
      return null;
    }
    const previous = await this.menuService.getVersionDays(versionId);
    const { days } = menuRequest.request;
    return days === null || days === previous.length ? { previous, target } : null;
  }

  /**
   * Resolves the request with the one the chat gathered and keeps the result when it changed. Only
   * a menu request brings new fields; any other intent reads what the chat gathered, unchanged. A
   * revision adds its constraints to the gathered ones.
   */
  private async mergeMenuRequest(
    conversation: Conversation,
    profile: ProfileContext | null,
    { intent, menuRequest }: IntentResult,
  ): Promise<ResolvedMenuRequest> {
    const isMenuRequest = intent === Intent.GenerateMenu || intent === Intent.ReviseMenu;
    const stored = this.conversationService.getMenuRequest(conversation);
    const resolved = resolveMenuRequest(profile, stored, isMenuRequest ? menuRequest : null, {
      revision: intent === Intent.ReviseMenu,
    });
    if (!isDeepStrictEqual(resolved.chat, stored ?? EMPTY_MENU_REQUEST)) {
      await this.conversationService.saveMenuRequest(conversation.id, resolved.chat);
    }
    return resolved;
  }

  /**
   * Brings the summary up to date for the next message. The reply is already saved and sent, so a
   * failure only leaves the summary behind: it is logged, and the next reply tries again.
   */
  private async summarize(
    conversation: Conversation,
    abortSignal: AbortSignal | undefined,
  ): Promise<void> {
    try {
      await this.conversationSummaryService.summarizeIfNeeded(conversation, abortSignal);
    } catch (error) {
      if (!abortSignal?.aborted) {
        this.logger.warn(
          `Conversation summary failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /** A response without a menu; `planMenu` saves and sends a menu itself. */
  private toEvents(
    response: Exclude<ChatResponse, { type: ChatResponseType.MenuReady }>,
  ): ChatStreamEvent[] {
    switch (response.type) {
      case ChatResponseType.Text:
        return [{ type: ChatStreamEventType.TextDelta, content: response.message }];
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
