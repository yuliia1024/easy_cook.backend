import { Injectable, Logger } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import {
  ASSISTANT_INVALID_OUTPUT_REPLY,
  ASSISTANT_UNAVAILABLE_REPLY,
  CONVERSATION_LIMIT_REPLY,
  CONVERSATION_MAX_USER_MESSAGES,
  ChatErrorCode,
  ChatTraceOutcome,
  ChatTraceStep,
  ChatResponseType,
  ChatStatusStep,
  ChatStreamEventType,
  INTERNAL_ERROR_REPLY,
  Intent,
  MENU_PLAN_FAILED_REPLY,
  MENU_SAVE_QUESTION,
  MenuTargetScope,
  MessageRole,
  OUT_OF_SCOPE_REPLY,
  CHAT_REPLY_TIMEOUT_MS,
  TEXT_PART_BREAKS,
  TEXT_PART_SEPARATOR,
  WishOfferAnswer,
} from '../../../common/constants';
import { IntentResult, MenuTarget, PreferenceChange, WishOffer } from '../../../common/contracts';
import {
  ChatProgressEvent,
  ChatResponse,
  ChatServiceCall,
  ChatStreamEvent,
  ProfileContext,
  ResolvedDay,
} from '../../../common/types';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
} from '../../../common/exceptions';
import { getRequestId } from '../../../common/logger';
import { withProgress } from '../../../common/utils';
import { AgentRunService } from '../agent-run/agent-run.service';
import { ChatTrace } from '../chat-trace/chat-trace';
import { ChatTraceService } from '../chat-trace/chat-trace.service';
import { Conversation } from '../../../generated/prisma/client';
import { ConversationWithMessages } from '../../data-access/conversation/conversation.repository';
import { toIntentResult } from '../chat-tools/chat-service-call';
import { ChatToolCall } from '../chat-tools/chat-tool-registry';
import { ConversationService, ModelHistory } from '../conversation/conversation.service';
import { ConversationSummaryService } from '../conversation-summary/conversation-summary.service';
import { pendingWishOffer } from '../conversation/pending-wish-offer';
import { GeneralChatService } from '../general-chat/general-chat.service';
import { IntentService, resolveIntent } from '../intent/intent.service';
import { MenuPlannerService } from '../menu/menu-planner.service';
import { MenuService } from '../menu/menu.service';
import {
  describeMenuRequest,
  EMPTY_MENU_REQUEST,
  menuClarification,
  resolveClarification,
  resolveMenuRequest,
  ResolvedMenuRequest,
} from '../menu/menu-request';
import { readTargets, replacementClarification, resolveReplaceTarget } from '../menu/menu-target';
import { ProfileContextService } from '../profile-context/profile-context.service';

/** How the chat model's reply ended: the menu tool it called, and whether it changed the preferences. */
interface ChatReplyOutcome {
  serviceCall: ChatServiceCall | null;
  preferencesUpdated: boolean;
}

/** A change to some days or meals of the latest menu the chat suggested. */
interface Revision {
  previous: ResolvedDay[];
  /** The recipes earlier versions of the menu had and `previous` has not. */
  rejectedRecipeIds: Set<string>;
  targets: MenuTarget[];
}

/**
 * Whether the wishes of the request are still those of the offer, as the classifier may restate
 * them ("Sushi", "sushi rolls"); another wish ("more chicken") is a new request.
 */
export function sameWish(wishes: string | null, offered: string): boolean {
  if (wishes === null) {
    return false;
  }
  const [a, b] = [wishes, offered].map((text) => text.trim().toLowerCase());
  return a.includes(b) || b.includes(a);
}

/** An event as the trace keeps it: a menu by its ids, the rest as it was sent. */
function traceEvent(event: ChatStreamEvent): unknown {
  if (event.type === ChatStreamEventType.MenuReady) {
    const { menu: _menu, ...ids } = event;
    return ids;
  }
  return event;
}

/** A planned menu as the trace keeps it: one line per meal, the totals and the issues. */
function traceResponse(response: ChatResponse): unknown {
  if (response.type !== ChatResponseType.MenuReady) {
    return response;
  }
  const { menu, message, generatedWith } = response;
  return {
    type: response.type,
    message,
    generatedWith,
    dailyAverage: menu.dailyAverage,
    issues: menu.issues,
    days: menu.days.map((day) => ({
      dayIndex: day.dayIndex,
      totals: day.totals,
      meals: day.meals.map(
        (meal) => `${meal.mealType}: ${meal.recipeName} (${meal.recipeId}) x${meal.servings}`,
      ),
    })),
  };
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
 * complete, with the menu version it created and the preference change it proposed (applied only
 * after the user's yes); a failure becomes an `error` event and is not saved.
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
    private readonly chatTraceService: ChatTraceService,
    private readonly agentRunService: AgentRunService,
  ) {}

  /**
   * Saves the message and returns the reply as events, ending with `done`. 404 for an unknown
   * conversation comes before the stream. Once `abortSignal` aborts, the stream ends silently.
   * `wishOffer` is the button the user pressed on the wish offer of the latest reply: it answers
   * the offer without the classifier (ignored when no offer waits).
   */
  public async handleMessage(
    conversationId: string,
    content: string,
    abortSignal?: AbortSignal,
    wishOffer: WishOfferAnswer | null = null,
  ): Promise<AsyncGenerator<ChatStreamEvent>> {
    const conversation = await this.conversationService.getById(conversationId);
    const trace = this.chatTraceService.start(conversationId, content);
    const userMessages = conversation.messages.filter(({ role }) => role === MessageRole.User);
    if (userMessages.length >= CONVERSATION_MAX_USER_MESSAGES) {
      await this.finishRun(trace, ChatTraceOutcome.LimitReached, null, null, []);
      return this.limitReached();
    }
    const userMessageId = await this.conversationService.addUserMessage(conversation, content);
    return this.reply(conversation, content, abortSignal, trace, userMessageId, wishOffer);
  }

  /** Logs the run (`ChatTraceService`) and adds it to the audit log of the agent (`agent_runs`). */
  private async finishRun(
    trace: ChatTrace,
    outcome: ChatTraceOutcome,
    userMessageId: string | null,
    replyMessageId: string | null,
    toolCalls: ChatToolCall[],
  ): Promise<void> {
    const report = this.chatTraceService.finish(trace, outcome);
    await this.agentRunService.record({
      requestId: getRequestId() ?? null,
      conversationId: trace.conversationId,
      userMessageId,
      replyMessageId,
      ...report,
      toolCalls,
    });
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

  /**
   * The trace and the agent run end with the reply, also when the client goes away (`finally`): a
   * run is on record whatever its outcome. The whole reply has
   * `CHAT_REPLY_TIMEOUT_MS`: past it every model call is aborted and the reply ends with a
   * retryable `assistant_unavailable`, while a client that went away (`abortSignal`) ends it
   * silently.
   */
  private async *reply(
    conversation: ConversationWithMessages,
    content: string,
    abortSignal: AbortSignal | undefined,
    trace: ChatTrace,
    userMessageId: string,
    wishOfferAnswer: WishOfferAnswer | null = null,
  ): AsyncGenerator<ChatStreamEvent> {
    const conversationId = conversation.id;
    let replyMessageId: string | null = null;
    const deadline = AbortSignal.timeout(CHAT_REPLY_TIMEOUT_MS);
    const signal = abortSignal ? AbortSignal.any([abortSignal, deadline]) : deadline;
    let reply = '';
    let menu: Extract<ChatStreamEvent, { type: ChatStreamEventType.MenuReady }> | undefined;
    let failed = false;
    let outcome = ChatTraceOutcome.Aborted;
    let textEnded = false;
    let preferenceChange: PreferenceChange | undefined;
    let wishOffer: WishOffer | undefined;
    const toolCalls: ChatToolCall[] = [];
    try {
      for await (const event of this.route(
        conversation,
        content,
        signal,
        trace,
        toolCalls,
        wishOfferAnswer,
      )) {
        if (event.type === ChatStreamEventType.TextDelta) {
          trace.textSent();
          reply += textEnded && reply ? `${TEXT_PART_SEPARATOR}${event.content}` : event.content;
          textEnded = false;
        } else {
          textEnded = TEXT_PART_BREAKS.has(event.type);
          trace.add(ChatTraceStep.Event, traceEvent(event));
          if (event.type === ChatStreamEventType.Clarification) {
            trace.textSent();
            reply += event.message;
          } else if (event.type === ChatStreamEventType.MenuReady) {
            menu = event;
          } else if (event.type === ChatStreamEventType.PreferenceChangeProposed) {
            preferenceChange = event.change;
          } else if (event.type === ChatStreamEventType.WishOfferProposed) {
            wishOffer = event.offer;
          } else if (event.type === ChatStreamEventType.Error) {
            failed = true;
          }
        }
        yield event;
      }
      if (abortSignal?.aborted) {
        return;
      }
      if (!failed && reply) {
        replyMessageId = await this.conversationService.addAssistantMessage(conversationId, reply, {
          menuVersionId: menu?.versionId,
          preferenceChange,
          wishOffer,
          toolCalls,
        });
        trace.add(ChatTraceStep.Saved, {
          content: reply,
          menuVersionId: menu?.versionId ?? null,
          preferenceChange: preferenceChange ?? null,
          wishOffer: wishOffer ?? null,
        });
        await this.summarize(conversation, signal);
      }
      outcome = failed ? ChatTraceOutcome.Failed : ChatTraceOutcome.Replied;
    } catch (error) {
      if (abortSignal?.aborted) {
        return;
      }
      trace.addError(error);
      outcome = ChatTraceOutcome.Failed;
      const event = deadline.aborted ? this.timedOut() : this.errorEvent(error);
      trace.add(ChatTraceStep.Event, traceEvent(event));
      yield event;
    } finally {
      await this.finishRun(trace, outcome, userMessageId, replyMessageId, toolCalls);
    }
    yield { type: ChatStreamEventType.Done };
  }

  /**
   * A press of a wish offer button answers the offer the latest reply made without the
   * classifier: a menu request with that answer.
   */
  private async *route(
    conversation: ConversationWithMessages,
    content: string,
    abortSignal: AbortSignal | undefined,
    trace: ChatTrace,
    toolCalls: ChatToolCall[],
    wishOfferAnswer: WishOfferAnswer | null,
  ): AsyncGenerator<ChatStreamEvent> {
    yield { type: ChatStreamEventType.Status, step: ChatStatusStep.Thinking };
    const profile = await this.profileContextService.find();
    const history = await this.conversationService.getModelHistory(conversation);
    const storedMenuRequest = this.conversationService.getMenuRequest(conversation);
    trace.add(ChatTraceStep.Context, {
      profile,
      menuRequest: storedMenuRequest,
      summary: history.summary,
      messages: history.messages.map(({ role, content: text, menuVersionId }) => ({
        role,
        content: text,
        menuVersionId: menuVersionId ?? null,
      })),
    });
    const pressed =
      wishOfferAnswer && pendingWishOffer(conversation.messages) ? wishOfferAnswer : null;
    const classified: IntentResult = pressed
      ? {
          intent: Intent.GenerateMenu,
          request: null,
          menuRequest: null,
          targets: null,
          wishOffer: pressed,
        }
      : await this.intentService.classify(history, storedMenuRequest, profile, abortSignal);
    trace.add(ChatTraceStep.Intent, classified);
    yield* this.answer(
      conversation,
      content,
      profile,
      history,
      classified,
      abortSignal,
      trace,
      toolCalls,
    );
  }

  /**
   * Answers the classified message. A menu tool the chat model called (`plan_menu`,
   * `revise_menu`) comes back here as the classification of a menu request (`toIntentResult`,
   * `resolveIntent`), so it is merged, clarified, planned, checked and saved exactly as one the
   * classifier found.
   */
  private async *answer(
    conversation: ConversationWithMessages,
    content: string,
    profile: ProfileContext | null,
    history: ModelHistory,
    classified: IntentResult,
    abortSignal: AbortSignal | undefined,
    trace: ChatTrace,
    toolCalls: ChatToolCall[],
  ): AsyncGenerator<ChatStreamEvent> {
    // The answer to the wish offer of the latest reply; the classifier may give one to no offer.
    // A message with another wish ("then with chicken") is a new request, whatever it answered.
    const offer = pendingWishOffer(conversation.messages);
    let menuRequest = await this.mergeMenuRequest(conversation, profile, classified);
    const offerAnswer =
      offer && sameWish(menuRequest.chat.wishes, offer.wishes) ? classified.wishOffer : null;
    // Answered either way, the wish is closed: an accepted one would only make the same offer
    // again on the next plan. The request of this plan still names it when accepted.
    let answeredRequest: string | null = null;
    if (offer && offerAnswer) {
      const answered = await this.withoutWishes(conversation.id, menuRequest);
      answeredRequest = describeMenuRequest(
        (offerAnswer === WishOfferAnswer.Accept ? menuRequest : answered).request,
      );
      menuRequest = answered;
    }
    trace.add(ChatTraceStep.MenuRequest, menuRequest);
    const { intent, request, targets } = resolveClarification(classified, menuRequest);
    const clarification = menuClarification(intent, menuRequest);
    trace.add(ChatTraceStep.Route, { intent, request, targets, clarification });
    if (clarification) {
      yield { type: ChatStreamEventType.Clarification, ...clarification };
      return;
    }
    switch (intent) {
      case Intent.GeneralChat: {
        const { serviceCall, preferencesUpdated } = yield* this.chat(
          conversation.id,
          history,
          menuRequest,
          profile,
          abortSignal,
          trace,
          toolCalls,
        );
        if (serviceCall) {
          this.logger.log(`The chat model called ${serviceCall.name}`);
          const asked = resolveIntent(toIntentResult(serviceCall), history.messages);
          trace.add(ChatTraceStep.ServiceCall, { call: serviceCall, intent: asked });
          // A menu asked for after a change of the preferences in this reply follows the change.
          const current = preferencesUpdated ? await this.profileContextService.find() : profile;
          yield* this.answer(
            conversation,
            content,
            current,
            history,
            asked,
            abortSignal,
            trace,
            toolCalls,
          );
        }
        return;
      }
      // A change to some days or meals plans only those parts again; any other change plans the
      // whole menu again from the restated request.
      case Intent.GenerateMenu:
      case Intent.ReviseMenu:
        yield* this.planMenu(
          conversation,
          request ?? answeredRequest ?? content,
          menuRequest,
          profile,
          abortSignal,
          intent === Intent.ReviseMenu ? targets : null,
          trace,
          offerAnswer === WishOfferAnswer.Accept ? offer : null,
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
   * Streams the chat model's reply with the steps of its tools; every tool call goes to the trace
   * and to `toolCalls`.
   * Returns the menu tool it called, if any, and whether a tool changed the preferences.
   */
  private async *chat(
    conversationId: string,
    history: ModelHistory,
    menuRequest: ResolvedMenuRequest,
    profile: ProfileContext | null,
    abortSignal: AbortSignal | undefined,
    trace: ChatTrace,
    /** Every tool call goes here too, to be saved with the reply. */
    toolCalls: ChatToolCall[],
  ): AsyncGenerator<ChatStreamEvent, ChatReplyOutcome> {
    let preferencesUpdated = false;
    const reply = this.generalChatService.reply(
      history,
      menuRequest.chat,
      profile,
      conversationId,
      abortSignal,
      (call) => {
        toolCalls.push(call);
        trace.addToolCall(call);
      },
    );
    for (;;) {
      const next = await reply.next();
      if (next.done === true) {
        return { serviceCall: next.value, preferencesUpdated };
      }
      if (typeof next.value === 'string') {
        yield { type: ChatStreamEventType.TextDelta, content: next.value };
      } else {
        preferencesUpdated ||= next.value.type === ChatStreamEventType.PreferencesUpdated;
        yield next.value;
      }
    }
  }

  /**
   * A plan still invalid after every attempt of the planner ends with `MENU_PLAN_FAILED_REPLY`. A planned
   * menu is saved as a draft version before it is sent, so the client gets its ids. A revision of
   * some days or meals of the latest suggested menu (`revisionOf`) changes only those parts and
   * keeps the rest, in one new version; a target the menu cannot pin down is asked about instead
   * (`replacementClarification`).
   */
  private async *planMenu(
    conversation: ConversationWithMessages,
    request: string,
    menuRequest: ResolvedMenuRequest,
    profile: ProfileContext | null,
    abortSignal: AbortSignal | undefined,
    targets: MenuTarget[] | null,
    trace: ChatTrace,
    acceptedOffer: WishOffer | null = null,
  ): AsyncGenerator<ChatStreamEvent> {
    const revision = await this.revisionOf(conversation, targets, menuRequest);
    const clarification = revision && replacementClarification(revision.targets, revision.previous);
    if (clarification) {
      yield { type: ChatStreamEventType.Clarification, ...clarification };
      return;
    }
    let response: ChatResponse;
    try {
      response = yield* withProgress<ChatStreamEvent, ChatResponse>((onProgress) =>
        this.planned(
          request,
          menuRequest,
          profile,
          revision,
          abortSignal,
          onProgress,
          acceptedOffer,
        ),
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
    trace.add(ChatTraceStep.MenuPlan, {
      request,
      revision: revision && {
        targets: revision.targets,
        previousDays: revision.previous.length,
        rejectedRecipeIds: [...revision.rejectedRecipeIds],
      },
      response: traceResponse(response),
    });
    if (response.type === ChatResponseType.MenuReady) {
      const saved = await this.menuService.saveGenerated(conversation, {
        menu: response.menu,
        days: response.days,
        nutritionGoal: profile?.nutritionGoal ?? null,
        generatedWith: response.generatedWith,
      });
      yield { type: ChatStreamEventType.TextDelta, content: response.message };
      yield { type: ChatStreamEventType.MenuReady, ...saved, menu: response.menu };
      yield { type: ChatStreamEventType.TextDelta, content: MENU_SAVE_QUESTION };
      return;
    }
    yield* this.toEvents(response);
  }

  /**
   * The days and the meals of the revision planned again (`resolveReplaceTarget`), or else the
   * whole menu: also when the revision names every day.
   */
  private planned(
    request: string,
    menuRequest: ResolvedMenuRequest,
    profile: ProfileContext | null,
    revision: Revision | null,
    abortSignal: AbortSignal | undefined,
    onProgress: (event: ChatProgressEvent) => void,
    acceptedOffer: WishOffer | null,
  ): Promise<ChatResponse> {
    const replacement = revision && resolveReplaceTarget(revision.targets, revision.previous);
    if (replacement) {
      return this.menuPlannerService.replan(
        request,
        menuRequest.request,
        profile,
        revision.previous,
        replacement,
        abortSignal,
        onProgress,
        revision.rejectedRecipeIds,
      );
    }
    return this.menuPlannerService.plan(
      request,
      menuRequest.request,
      profile,
      abortSignal,
      onProgress,
      acceptedOffer,
    );
  }

  /** The request without its wishes, kept so: the user answered the offer for them. */
  private async withoutWishes(
    conversationId: string,
    menuRequest: ResolvedMenuRequest,
  ): Promise<ResolvedMenuRequest> {
    const chat = { ...menuRequest.chat, wishes: null };
    await this.conversationService.saveMenuRequest(conversationId, chat);
    return { ...menuRequest, chat, request: { ...menuRequest.request, wishes: null } };
  }

  /**
   * The latest menu the chat suggested and the parts of it a revision targets as the app reads
   * them (`readTargets`), when the request keeps its number of days; null for a change to the whole menu, without a suggested menu or
   * with another number of days, and the whole menu is planned again.
   */
  private async revisionOf(
    conversation: ConversationWithMessages,
    targets: MenuTarget[] | null,
    menuRequest: ResolvedMenuRequest,
  ): Promise<Revision | null> {
    if (!targets?.length || targets.some(({ scope }) => scope === MenuTargetScope.Menu)) {
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
    const { days: previous, rejectedRecipeIds } = await this.menuService.getRevisionBase(versionId);
    const { days } = menuRequest.request;
    return days === null || days === previous.length
      ? { previous, rejectedRecipeIds, targets: readTargets(targets, previous.length) }
      : null;
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
      case ChatResponseType.WishOffer:
        return [
          { type: ChatStreamEventType.TextDelta, content: response.message },
          { type: ChatStreamEventType.WishOfferProposed, offer: response.offer },
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

  private timedOut(): ChatStreamEvent {
    this.logger.warn(`Chat reply took longer than ${CHAT_REPLY_TIMEOUT_MS} ms and was stopped`);
    return this.assistantUnavailable(true);
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
