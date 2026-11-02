import {
  ASSISTANT_INVALID_OUTPUT_REPLY,
  ASSISTANT_UNAVAILABLE_REPLY,
  CalculationMode,
  ChatErrorCode,
  CLARIFICATION_REPLY,
  CONVERSATION_LIMIT_REPLY,
  CONVERSATION_MAX_USER_MESSAGES,
  ChatResponseType,
  ChatStatusStep,
  DietTag,
  Goal,
  ChatStreamEventType,
  daysOutOfRangeReply,
  INTERNAL_ERROR_REPLY,
  Intent,
  MealType,
  MENU_PLAN_FAILED_REPLY,
  MessageRole,
  OUT_OF_SCOPE_REPLY,
} from '../../../common/constants';
import { MenuRequest } from '../../../common/contracts';
import { ChatStreamEvent, MenuComposition, ProfileContext } from '../../../common/types';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
  ConversationNotFoundException,
} from '../../../common/exceptions';
import { createMock } from '../../../test/create-mock';
import {
  buildConversation,
  buildMessage,
  CONVERSATION_ID,
  MENU_ID,
  MENU_VERSION_ID,
  PROFILE_ID,
} from '../../../test/fixtures';
import { ConversationService, ModelHistory } from '../conversation/conversation.service';
import { ConversationSummaryService } from '../conversation-summary/conversation-summary.service';
import { GeneralChatService } from '../general-chat/general-chat.service';
import { IntentService } from '../intent/intent.service';
import { MenuPlannerService } from '../menu/menu-planner.service';
import { MenuService } from '../menu/menu.service';
import { EMPTY_MENU_REQUEST } from '../menu/menu-request';
import { ProfileContextService } from '../profile-context/profile-context.service';
import { ChatOrchestratorService } from './chat-orchestrator.service';

const generatedWith = { modelId: 'gpt-test', prompt: 'menu-plan@v1' };

describe('ChatOrchestratorService', () => {
  let conversationService: jest.Mocked<ConversationService>;
  let intentService: jest.Mocked<IntentService>;
  let generalChatService: jest.Mocked<GeneralChatService>;
  let menuPlannerService: jest.Mocked<MenuPlannerService>;
  let menuService: jest.Mocked<MenuService>;
  let profileContextService: jest.Mocked<ProfileContextService>;
  let conversationSummaryService: jest.Mocked<ConversationSummaryService>;
  let service: ChatOrchestratorService;
  const conversation = buildConversation();
  const history: ModelHistory = { summary: 'Rejected the salmon.', messages: [buildMessage()] };
  const profile: ProfileContext = {
    profileId: PROFILE_ID,
    goal: Goal.Maintain,
    nutritionGoal: null,
    rules: { diets: [], allergies: [], excludedIngredients: [], dislikedFoods: [] },
  };

  const collect = async (stream: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> => {
    const events: ChatStreamEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    return events;
  };
  const menu: MenuComposition = {
    days: [],
    dailyAverage: { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
    issues: [],
  };
  const saved = { menuId: MENU_ID, versionId: MENU_VERSION_ID };
  const isProgress = ({ type }: ChatStreamEvent): boolean =>
    type === ChatStreamEventType.Status || type === ChatStreamEventType.MenuPending;
  /** The events of the reply, progress left out; `sendAll` keeps it. */
  const sendAll = async (content = 'Hi', signal?: AbortSignal): Promise<ChatStreamEvent[]> =>
    collect(await service.handleMessage(CONVERSATION_ID, content, signal));
  const send = async (content = 'Hi', signal?: AbortSignal): Promise<ChatStreamEvent[]> =>
    (await sendAll(content, signal)).filter((event) => !isProgress(event));
  const classifyAs = (
    intent: Intent,
    request: string | null = null,
    menuRequest: MenuRequest | null = null,
  ): void => {
    intentService.classify.mockResolvedValue({ intent, request, menuRequest, target: null });
  };

  beforeEach(() => {
    conversationService = createMock<ConversationService>();
    conversationService.getById.mockResolvedValue(conversation);
    conversationService.getMenuRequest.mockReturnValue(null);
    conversationService.getModelHistory.mockResolvedValue(history);
    intentService = createMock<IntentService>();
    generalChatService = createMock<GeneralChatService>();
    generalChatService.reply.mockImplementation(async function* () {
      yield 'A ';
      yield 'reply';
    });
    menuPlannerService = createMock<MenuPlannerService>();
    menuPlannerService.plan.mockResolvedValue({
      type: ChatResponseType.MenuReady,
      message: 'Your day',
      menu,
      days: [],
      generatedWith,
    });
    menuService = createMock<MenuService>();
    menuService.saveGenerated.mockResolvedValue({ menuId: MENU_ID, versionId: MENU_VERSION_ID });
    profileContextService = createMock<ProfileContextService>();
    profileContextService.find.mockResolvedValue(profile);
    conversationSummaryService = createMock<ConversationSummaryService>();
    conversationSummaryService.summarizeIfNeeded.mockResolvedValue(false);
    service = new ChatOrchestratorService(
      conversationService,
      intentService,
      generalChatService,
      menuPlannerService,
      menuService,
      profileContextService,
      conversationSummaryService,
    );
  });

  it('saves the message before the stream and fails for an unknown conversation first', async () => {
    classifyAs(Intent.GeneralChat);
    await service.handleMessage(CONVERSATION_ID, 'Hi');

    expect(conversationService.addUserMessage).toHaveBeenCalledWith(conversation, 'Hi');
    expect(intentService.classify).not.toHaveBeenCalled();

    conversationService.addUserMessage.mockClear();
    conversationService.getById.mockRejectedValue(new ConversationNotFoundException());
    await expect(service.handleMessage(CONVERSATION_ID, 'Hi')).rejects.toBeInstanceOf(
      ConversationNotFoundException,
    );
    expect(conversationService.addUserMessage).not.toHaveBeenCalled();
  });

  it('streams general chat from GeneralChatService and saves the whole reply', async () => {
    classifyAs(Intent.GeneralChat);
    const abort = new AbortController();

    await expect(send('Hello there', abort.signal)).resolves.toEqual([
      { type: ChatStreamEventType.TextDelta, content: 'A ' },
      { type: ChatStreamEventType.TextDelta, content: 'reply' },
      { type: ChatStreamEventType.Done },
    ]);
    expect(profileContextService.find).toHaveBeenCalledTimes(1);
    expect(conversationService.getModelHistory).toHaveBeenCalledWith(conversation);
    expect(intentService.classify).toHaveBeenCalledWith(history, null, profile, abort.signal);
    expect(generalChatService.reply).toHaveBeenCalledWith(
      history,
      EMPTY_MENU_REQUEST,
      profile,
      abort.signal,
    );
    expect(conversationService.addAssistantMessage).toHaveBeenCalledWith(
      CONVERSATION_ID,
      'A reply',
      undefined,
    );
    expect(menuPlannerService.plan).not.toHaveBeenCalled();
  });

  it('says it is thinking first and keeps the status out of the saved reply', async () => {
    classifyAs(Intent.GeneralChat);

    await expect(sendAll()).resolves.toEqual([
      { type: ChatStreamEventType.Status, step: ChatStatusStep.Thinking },
      { type: ChatStreamEventType.TextDelta, content: 'A ' },
      { type: ChatStreamEventType.TextDelta, content: 'reply' },
      { type: ChatStreamEventType.Done },
    ]);
    expect(conversationService.addAssistantMessage).toHaveBeenCalledWith(
      CONVERSATION_ID,
      'A reply',
      undefined,
    );
  });

  it('streams the progress of the planner while it plans, before the menu', async () => {
    classifyAs(Intent.GenerateMenu, 'Plan a one-day menu.');
    const pending: ChatStreamEvent = {
      type: ChatStreamEventType.MenuPending,
      days: 1,
      mealTypes: [MealType.Breakfast],
    };
    menuPlannerService.plan.mockImplementation(
      async (_message, _request, _profile, _signal, onProgress) => {
        onProgress?.({
          type: ChatStreamEventType.Status,
          step: ChatStatusStep.SearchingBreakfasts,
        });
        await Promise.resolve();
        onProgress?.(pending);
        return {
          type: ChatResponseType.MenuReady,
          message: 'Your day',
          menu,
          days: [],
          generatedWith,
        };
      },
    );

    await expect(sendAll()).resolves.toEqual([
      { type: ChatStreamEventType.Status, step: ChatStatusStep.Thinking },
      { type: ChatStreamEventType.Status, step: ChatStatusStep.SearchingBreakfasts },
      pending,
      { type: ChatStreamEventType.TextDelta, content: 'Your day' },
      { type: ChatStreamEventType.MenuReady, ...saved, menu },
      { type: ChatStreamEventType.Done },
    ]);
    expect(conversationService.addAssistantMessage).toHaveBeenCalledWith(
      CONVERSATION_ID,
      'Your day',
      MENU_VERSION_ID,
    );
  });

  it('hands the restated request to MenuPlannerService, saves the menu as a draft and the message with its version', async () => {
    classifyAs(Intent.GenerateMenu, 'Plan a one-day menu.');
    const abort = new AbortController();

    await expect(send('done do it again', abort.signal)).resolves.toEqual([
      { type: ChatStreamEventType.TextDelta, content: 'Your day' },
      { type: ChatStreamEventType.MenuReady, ...saved, menu },
      { type: ChatStreamEventType.Done },
    ]);
    expect(profileContextService.find).toHaveBeenCalledTimes(1);
    expect(intentService.classify).toHaveBeenCalledWith(history, null, profile, abort.signal);
    expect(menuPlannerService.plan).toHaveBeenCalledWith(
      'Plan a one-day menu.',
      EMPTY_MENU_REQUEST,
      profile,
      abort.signal,
      expect.any(Function),
    );
    expect(menuService.saveGenerated).toHaveBeenCalledWith(conversation, {
      menu,
      days: [],
      nutritionGoal: null,
      generatedWith,
    });
    expect(conversationService.addAssistantMessage).toHaveBeenCalledWith(
      CONVERSATION_ID,
      'Your day',
      MENU_VERSION_ID,
    );
    expect(generalChatService.reply).not.toHaveBeenCalled();
  });

  it('plans a revision of the menu again from the restated request', async () => {
    classifyAs(Intent.ReviseMenu, 'Plan a one-day menu with another lunch.');

    await expect(send('replace the lunch')).resolves.toEqual([
      { type: ChatStreamEventType.TextDelta, content: 'Your day' },
      { type: ChatStreamEventType.MenuReady, ...saved, menu },
      { type: ChatStreamEventType.Done },
    ]);
    expect(menuPlannerService.plan).toHaveBeenCalledWith(
      'Plan a one-day menu with another lunch.',
      EMPTY_MENU_REQUEST,
      profile,
      undefined,
      expect.any(Function),
    );
  });

  it('plans from the message itself when the classifier restated no request', async () => {
    classifyAs(Intent.GenerateMenu);

    await send('Plan a day');

    expect(menuPlannerService.plan).toHaveBeenCalledWith(
      'Plan a day',
      EMPTY_MENU_REQUEST,
      profile,
      undefined,
      expect.any(Function),
    );
  });

  it('passes a missing profile on as null', async () => {
    profileContextService.find.mockResolvedValue(null);
    classifyAs(Intent.GenerateMenu);

    await send('Plan a day');

    expect(intentService.classify).toHaveBeenCalledWith(history, null, null, undefined);
    expect(menuPlannerService.plan).toHaveBeenCalledWith(
      'Plan a day',
      EMPTY_MENU_REQUEST,
      null,
      undefined,
      expect.any(Function),
    );
  });

  it('streams a planner text reply as text', async () => {
    classifyAs(Intent.GenerateMenu);
    menuPlannerService.plan.mockResolvedValue({
      type: ChatResponseType.Text,
      message: 'No recipes',
    });

    await expect(send()).resolves.toEqual([
      { type: ChatStreamEventType.TextDelta, content: 'No recipes' },
      { type: ChatStreamEventType.Done },
    ]);
    expect(menuService.saveGenerated).not.toHaveBeenCalled();
  });

  it('adds the version to the menu of the conversation with the goal of the profile', async () => {
    const nutritionGoal = {
      goalId: 'g',
      caloriesKcal: 2000,
      proteinG: 100,
      fatG: 60,
      carbsG: 260,
      calculationMode: CalculationMode.Manual,
      ruleVersion: null,
    };
    const linked = buildConversation({ menuId: MENU_ID });
    conversationService.getById.mockResolvedValue(linked);
    profileContextService.find.mockResolvedValue({ ...profile, nutritionGoal });
    classifyAs(Intent.ReviseMenu, 'Another lunch.');

    await send();

    expect(menuService.saveGenerated).toHaveBeenCalledWith(linked, {
      menu,
      days: [],
      nutritionGoal,
      generatedWith,
    });
  });

  it('saves no reply when saving the menu fails', async () => {
    classifyAs(Intent.GenerateMenu);
    menuService.saveGenerated.mockRejectedValue(new Error('db down'));

    const events = await send();

    expect(events.map((e) => e.type)).toEqual([
      ChatStreamEventType.Error,
      ChatStreamEventType.Done,
    ]);
    expect(conversationService.addAssistantMessage).not.toHaveBeenCalled();
  });

  it('passes a planner error through and saves no reply', async () => {
    classifyAs(Intent.GenerateMenu);
    const error = { code: 'x', message: 'No', retryable: false };
    menuPlannerService.plan.mockResolvedValue({ type: ChatResponseType.Error, ...error });

    await expect(send()).resolves.toEqual([
      { type: ChatStreamEventType.Error, ...error },
      { type: ChatStreamEventType.Done },
    ]);
    expect(conversationService.addAssistantMessage).not.toHaveBeenCalled();
  });

  it('plans the request merged with the profile, its days included', async () => {
    const withGoal: ProfileContext = {
      ...profile,
      nutritionGoal: {
        goalId: 'g',
        caloriesKcal: 1800,
        proteinG: 100,
        fatG: 50,
        carbsG: 200,
        calculationMode: CalculationMode.Manual,
        ruleVersion: null,
      },
    };
    profileContextService.find.mockResolvedValue(withGoal);
    classifyAs(Intent.GenerateMenu, 'Plan a 5-day menu.', { ...EMPTY_MENU_REQUEST, days: 5 });

    await send('5 days please');

    expect(menuPlannerService.plan).toHaveBeenCalledWith(
      'Plan a 5-day menu.',
      { ...EMPTY_MENU_REQUEST, days: 5, caloriesKcal: 1800 },
      withGoal,
      undefined,
      expect.any(Function),
    );
  });

  it('shows that the menu failed when the last attempt of the planner was invalid, and saves no reply', async () => {
    classifyAs(Intent.GenerateMenu);
    menuPlannerService.plan.mockRejectedValue(new AssistantInvalidOutputException());

    await expect(send()).resolves.toEqual([
      {
        type: ChatStreamEventType.Error,
        code: ChatErrorCode.AssistantInvalidOutput,
        message: MENU_PLAN_FAILED_REPLY,
        retryable: true,
      },
      { type: ChatStreamEventType.Done },
    ]);
    expect(conversationService.addAssistantMessage).not.toHaveBeenCalled();
  });

  it('passes a planner clarification through', async () => {
    classifyAs(Intent.GenerateMenu);
    const clarification = { message: 'How many days?', missingFields: ['days'] };
    menuPlannerService.plan.mockResolvedValue({
      type: ChatResponseType.Clarification,
      ...clarification,
    });

    await expect(send()).resolves.toEqual([
      { type: ChatStreamEventType.Clarification, ...clarification },
      { type: ChatStreamEventType.Done },
    ]);
  });

  it('asks for clarification without the model or menu generation', async () => {
    classifyAs(Intent.Clarification);

    await expect(send('Make a menu')).resolves.toEqual([
      {
        type: ChatStreamEventType.Clarification,
        message: CLARIFICATION_REPLY,
        missingFields: ['days', 'mealTypes'],
      },
      { type: ChatStreamEventType.Done },
    ]);
    expect(generalChatService.reply).not.toHaveBeenCalled();
    expect(menuPlannerService.plan).not.toHaveBeenCalled();
    expect(conversationService.addAssistantMessage).toHaveBeenCalledWith(
      CONVERSATION_ID,
      CLARIFICATION_REPLY,
      undefined,
    );
    expect(conversationService.saveMenuRequest).not.toHaveBeenCalled();
  });

  it('asks only for the fields the conversation does not have yet', async () => {
    conversationService.getMenuRequest.mockReturnValue({ ...EMPTY_MENU_REQUEST, days: 3 });
    classifyAs(Intent.Clarification);

    await expect(send('Make a menu')).resolves.toContainEqual(
      expect.objectContaining({ missingFields: ['mealTypes'] }),
    );
    expect(conversationService.getMenuRequest).toHaveBeenCalledWith(conversation);
  });

  it('plans the gathered request instead of asking when nothing is missing', async () => {
    conversationService.getMenuRequest.mockReturnValue({
      ...EMPTY_MENU_REQUEST,
      days: 3,
      mealTypes: [MealType.Dinner],
    });
    classifyAs(Intent.Clarification);

    await expect(send('and another one')).resolves.toEqual([
      { type: ChatStreamEventType.TextDelta, content: 'Your day' },
      { type: ChatStreamEventType.MenuReady, ...saved, menu },
      { type: ChatStreamEventType.Done },
    ]);
    expect(menuPlannerService.plan).toHaveBeenCalledWith(
      'Plan a 3-day menu with dinner.',
      { ...EMPTY_MENU_REQUEST, days: 3, mealTypes: [MealType.Dinner] },
      profile,
      undefined,
      expect.any(Function),
    );
    expect(conversationService.saveMenuRequest).not.toHaveBeenCalled();
  });

  it('merges the request fields of the message into the conversation', async () => {
    conversationService.getMenuRequest.mockReturnValue({
      ...EMPTY_MENU_REQUEST,
      days: 3,
      excludedIngredients: ['mushrooms'],
    });
    classifyAs(Intent.GenerateMenu, 'Plan a 3-day vegan menu.', {
      ...EMPTY_MENU_REQUEST,
      diets: [DietTag.Vegan],
    });

    await send('make it vegan');

    expect(conversationService.saveMenuRequest).toHaveBeenCalledWith(CONVERSATION_ID, {
      ...EMPTY_MENU_REQUEST,
      days: 3,
      diets: [DietTag.Vegan],
      excludedIngredients: ['mushrooms'],
    });
    expect(menuPlannerService.plan).toHaveBeenCalled();
  });

  it('keeps the constraints of the conversation for a revision that names only the change', async () => {
    conversationService.getMenuRequest.mockReturnValue({
      ...EMPTY_MENU_REQUEST,
      days: 3,
      mealTypes: [MealType.Lunch],
      excludedIngredients: ['mushrooms'],
    });
    classifyAs(Intent.ReviseMenu, 'Plan a 3-day menu without chicken.', {
      ...EMPTY_MENU_REQUEST,
      excludedIngredients: ['chicken'],
    });

    await send('redo it without chicken');

    const expected = {
      ...EMPTY_MENU_REQUEST,
      days: 3,
      mealTypes: [MealType.Lunch],
      excludedIngredients: ['mushrooms', 'chicken'],
    };
    expect(conversationService.saveMenuRequest).toHaveBeenCalledWith(CONVERSATION_ID, expected);
    expect(menuPlannerService.plan).toHaveBeenCalledWith(
      'Plan a 3-day menu without chicken.',
      expect.objectContaining({ excludedIngredients: ['mushrooms', 'chicken'] }),
      profile,
      undefined,
      expect.any(Function),
    );
  });

  it.each([Intent.GeneralChat, Intent.Clarification, Intent.OutOfScope])(
    'keeps request fields of %s out of the conversation',
    async (intent) => {
      classifyAs(intent, null, { ...EMPTY_MENU_REQUEST, days: 3 });

      await send('Hi');

      expect(conversationService.saveMenuRequest).not.toHaveBeenCalled();
    },
  );

  it('does not save a request that did not change', async () => {
    const stored = { ...EMPTY_MENU_REQUEST, days: 3 };
    conversationService.getMenuRequest.mockReturnValue(stored);
    classifyAs(Intent.GenerateMenu, 'Plan a 3-day menu.', { ...EMPTY_MENU_REQUEST, days: 3 });

    await send('again');

    expect(conversationService.saveMenuRequest).not.toHaveBeenCalled();
  });

  it.each([
    [10, 7],
    [0, 1],
    [-2, 1],
  ])('offers %i days as %i instead of planning and keeps the offer', async (requested, offered) => {
    classifyAs(Intent.GenerateMenu, `Plan a ${requested}-day menu.`, {
      ...EMPTY_MENU_REQUEST,
      days: requested,
      mealTypes: [MealType.Lunch],
    });

    const message = daysOutOfRangeReply(requested, offered);
    await expect(send()).resolves.toEqual([
      { type: ChatStreamEventType.Clarification, message, missingFields: ['days'] },
      { type: ChatStreamEventType.Done },
    ]);
    expect(menuPlannerService.plan).not.toHaveBeenCalled();
    expect(conversationService.saveMenuRequest).toHaveBeenCalledWith(CONVERSATION_ID, {
      ...EMPTY_MENU_REQUEST,
      days: offered,
      mealTypes: [MealType.Lunch],
    });
    expect(conversationService.addAssistantMessage).toHaveBeenCalledWith(
      CONVERSATION_ID,
      message,
      undefined,
    );
  });

  it('answers an unrelated request with the fixed reply', async () => {
    classifyAs(Intent.OutOfScope);

    await expect(send('Write a poem')).resolves.toEqual([
      { type: ChatStreamEventType.TextDelta, content: OUT_OF_SCOPE_REPLY },
      { type: ChatStreamEventType.Done },
    ]);
    expect(generalChatService.reply).not.toHaveBeenCalled();
    expect(menuPlannerService.plan).not.toHaveBeenCalled();
  });

  it.each([
    [
      new AssistantUnavailableException(false),
      'assistant_unavailable',
      ASSISTANT_UNAVAILABLE_REPLY,
      false,
    ],
    [
      new AssistantInvalidOutputException(),
      'assistant_invalid_output',
      ASSISTANT_INVALID_OUTPUT_REPLY,
      true,
    ],
  ])(
    'turns a classification failure (%p) into an error event',
    async (error, code, message, retryable) => {
      intentService.classify.mockRejectedValue(error);

      await expect(send()).resolves.toEqual([
        { type: ChatStreamEventType.Error, code, message, retryable },
        { type: ChatStreamEventType.Done },
      ]);
      expect(generalChatService.reply).not.toHaveBeenCalled();
      expect(menuPlannerService.plan).not.toHaveBeenCalled();
      expect(conversationService.addAssistantMessage).not.toHaveBeenCalled();
    },
  );

  it('does not save a reply that failed midway and hides unexpected errors', async () => {
    jest.spyOn(service['logger'], 'error').mockImplementation();
    classifyAs(Intent.GeneralChat);
    generalChatService.reply.mockImplementation(async function* () {
      yield 'A ';
      throw new Error('secret internals');
    });

    const events = await send();

    expect(events.slice(1)).toEqual([
      {
        type: ChatStreamEventType.Error,
        code: 'internal_error',
        message: INTERNAL_ERROR_REPLY,
        retryable: false,
      },
      { type: ChatStreamEventType.Done },
    ]);
    expect(JSON.stringify(events)).not.toContain('secret');
    expect(conversationService.addAssistantMessage).not.toHaveBeenCalled();
  });

  it('ends silently and saves nothing once the client is gone', async () => {
    classifyAs(Intent.GeneralChat);
    const abort = new AbortController();
    generalChatService.reply.mockImplementation(async function* () {
      yield 'A ';
      abort.abort();
      throw new Error('aborted');
    });

    await expect(send('Hi', abort.signal)).resolves.toEqual([
      { type: ChatStreamEventType.TextDelta, content: 'A ' },
    ]);
    expect(conversationService.addAssistantMessage).not.toHaveBeenCalled();
  });

  describe('context budget', () => {
    it('gives the classifier the menu request the chat gathered', async () => {
      const stored = { ...EMPTY_MENU_REQUEST, days: 3, excludedIngredients: ['mushrooms'] };
      conversationService.getMenuRequest.mockReturnValue(stored);
      classifyAs(Intent.GeneralChat);

      await send();

      expect(intentService.classify).toHaveBeenCalledWith(history, stored, profile, undefined);
      expect(generalChatService.reply).toHaveBeenCalledWith(history, stored, profile, undefined);
    });

    it('brings the summary up to date after a saved reply', async () => {
      classifyAs(Intent.GeneralChat);
      const abort = new AbortController();

      await send('Hi', abort.signal);

      expect(conversationSummaryService.summarizeIfNeeded).toHaveBeenCalledWith(
        conversation,
        abort.signal,
      );
      expect(conversationService.addAssistantMessage.mock.invocationCallOrder[0]).toBeLessThan(
        conversationSummaryService.summarizeIfNeeded.mock.invocationCallOrder[0],
      );
    });

    it('keeps the reply when the summary fails', async () => {
      classifyAs(Intent.GeneralChat);
      conversationSummaryService.summarizeIfNeeded.mockRejectedValue(
        new AssistantUnavailableException(true),
      );

      await expect(send()).resolves.toEqual([
        { type: ChatStreamEventType.TextDelta, content: 'A ' },
        { type: ChatStreamEventType.TextDelta, content: 'reply' },
        { type: ChatStreamEventType.Done },
      ]);
      expect(conversationService.addAssistantMessage).toHaveBeenCalled();
    });

    it('does not summarize after a failed reply', async () => {
      intentService.classify.mockRejectedValue(new AssistantUnavailableException(true));

      await send();

      expect(conversationSummaryService.summarizeIfNeeded).not.toHaveBeenCalled();
    });

    /** `users` messages of the user, each with a reply. */
    const chatOf = (users: number): ReturnType<typeof buildConversation> =>
      buildConversation({
        messages: Array.from({ length: users }, () => [
          buildMessage(),
          buildMessage({ role: MessageRole.Assistant }),
        ]).flat(),
      });

    it('answers a full conversation with an error, saving nothing and calling no model', async () => {
      conversationService.getById.mockResolvedValue(chatOf(CONVERSATION_MAX_USER_MESSAGES));

      await expect(sendAll()).resolves.toEqual([
        {
          type: ChatStreamEventType.Error,
          code: ChatErrorCode.ConversationLimitReached,
          message: CONVERSATION_LIMIT_REPLY,
          retryable: false,
        },
        { type: ChatStreamEventType.Done },
      ]);
      expect(conversationService.addUserMessage).not.toHaveBeenCalled();
      expect(intentService.classify).not.toHaveBeenCalled();
    });

    it('counts only the messages of the user', async () => {
      const conversation = chatOf(CONVERSATION_MAX_USER_MESSAGES - 1);
      conversation.messages.push(
        ...Array.from({ length: 10 }, () => buildMessage({ role: MessageRole.Assistant })),
      );
      conversationService.getById.mockResolvedValue(conversation);
      classifyAs(Intent.GeneralChat);

      await send();

      expect(conversationService.addUserMessage).toHaveBeenCalled();
    });
  });
});
