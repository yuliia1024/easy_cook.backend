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
  ChatToolName,
  ChatTraceOutcome,
  ChatTraceStep,
  DietTag,
  Goal,
  ChatStreamEventType,
  daysOutOfRangeReply,
  INTERNAL_ERROR_REPLY,
  Intent,
  MealType,
  MENU_MAX_DAYS,
  MENU_PLAN_FAILED_REPLY,
  MenuTargetField,
  MenuTargetScope,
  menuTargetDayReply,
  menuTargetMissingDayReply,
  menuTargetMissingMealReply,
  MessageRole,
  OUT_OF_SCOPE_REPLY,
} from '../../../common/constants';
import { MenuRequest, MenuTarget } from '../../../common/contracts';
import {
  ChatProgressEvent,
  ChatServiceCall,
  ChatStreamEvent,
  Environments,
  MenuComposition,
  ProfileContext,
  ResolvedDay,
} from '../../../common/types';
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
import { ApiConfigService } from '../../../configs/api-config/api-config.service';
import { ChatTraceRecord } from '../chat-trace/chat-trace';
import { ChatTraceService } from '../chat-trace/chat-trace.service';
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
  let chatTraceService: ChatTraceService;
  let traces: ChatTraceRecord[];
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
    intentService.classify.mockResolvedValue({ intent, request, menuRequest, targets: null });
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
      return null;
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
    traces = [];
    chatTraceService = new ChatTraceService({ env: Environments.LOCAL } as ApiConfigService);
    jest
      .spyOn(chatTraceService, 'finish')
      .mockImplementation((trace, outcome) => traces.push(trace.toRecord(outcome)));
    service = new ChatOrchestratorService(
      conversationService,
      intentService,
      generalChatService,
      menuPlannerService,
      menuService,
      profileContextService,
      conversationSummaryService,
      chatTraceService,
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
      expect.any(Function),
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

  describe('redoing some days or meals', () => {
    const OLD_VERSION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const previous = [0, 1, 2].map((dayIndex) => ({
      dayIndex,
      date: null,
      meals: [MealType.Breakfast, MealType.Lunch, MealType.Dinner].map((mealType) => ({
        mealType,
      })),
    }));
    const threeDays = { ...EMPTY_MENU_REQUEST, days: 3 };
    const withMenu = buildConversation({
      menuId: MENU_ID,
      messages: [
        buildMessage({ role: MessageRole.User }),
        buildMessage({ role: MessageRole.Assistant, menuVersionId: 'older' }),
        buildMessage({ role: MessageRole.Assistant, menuVersionId: OLD_VERSION_ID }),
        buildMessage({ role: MessageRole.Assistant, content: 'You are welcome' }),
      ],
    });
    const revise = (
      targets: MenuTarget[] | null,
      menuRequest: MenuRequest | null = threeDays,
    ): void => {
      intentService.classify.mockResolvedValue({
        intent: Intent.ReviseMenu,
        request: 'Plan a 3-day menu with another Tuesday.',
        menuRequest,
        targets,
      });
    };
    const dayTarget: MenuTarget = { scope: MenuTargetScope.Day, dayIndex: 1, mealType: null };
    const mealTarget: MenuTarget = {
      scope: MenuTargetScope.Meal,
      dayIndex: 2,
      mealType: MealType.Dinner,
    };

    beforeEach(() => {
      conversationService.getById.mockResolvedValue(withMenu);
      menuService.getRevisionBase.mockResolvedValue({
        days: previous as ResolvedDay[],
        rejectedRecipeIds: new Set(['rejected-recipe']),
      });
      menuPlannerService.replan.mockResolvedValue({
        type: ChatResponseType.MenuReady,
        message: 'A new Tuesday',
        menu,
        days: previous as ResolvedDay[],
        generatedWith,
      });
    });

    it('plans only the parts of the latest suggested menu and saves the menu as one new version', async () => {
      revise([dayTarget, mealTarget]);

      await expect(send('redo Tuesday and the dinner on Wednesday')).resolves.toEqual([
        { type: ChatStreamEventType.TextDelta, content: 'A new Tuesday' },
        { type: ChatStreamEventType.MenuReady, ...saved, menu },
        { type: ChatStreamEventType.Done },
      ]);
      expect(menuService.getRevisionBase).toHaveBeenCalledWith(OLD_VERSION_ID);
      expect(menuPlannerService.replan).toHaveBeenCalledWith(
        'Plan a 3-day menu with another Tuesday.',
        threeDays,
        profile,
        previous,
        { days: [1], meals: [{ dayIndex: 2, mealType: MealType.Dinner }] },
        undefined,
        expect.any(Function),
        new Set(['rejected-recipe']),
      );
      expect(menuPlannerService.replan).toHaveBeenCalledTimes(1);
      expect(menuPlannerService.plan).not.toHaveBeenCalled();
      expect(menuService.saveGenerated).toHaveBeenCalledTimes(1);
      expect(menuService.saveGenerated).toHaveBeenCalledWith(withMenu, {
        menu,
        days: previous,
        nutritionGoal: null,
        generatedWith,
      });
    });

    it('replaces every meal of a day as the whole day', async () => {
      revise(
        [MealType.Breakfast, MealType.Lunch, MealType.Dinner].map((mealType) => ({
          ...mealTarget,
          mealType,
        })),
      );

      await send('replace every meal on Wednesday');

      expect(menuPlannerService.replan.mock.calls[0][4]).toEqual({ days: [2], meals: [] });
    });

    it('replaces the meal of a one-day menu without a day named', async () => {
      menuService.getRevisionBase.mockResolvedValue({
        days: [previous[0]] as ResolvedDay[],
        rejectedRecipeIds: new Set(),
      });
      revise([{ ...mealTarget, dayIndex: null }], { ...threeDays, days: 1 });

      await send('another dinner');

      expect(menuPlannerService.replan.mock.calls[0][4]).toEqual({
        days: [],
        meals: [{ dayIndex: 0, mealType: MealType.Dinner }],
      });
    });

    it('asks which day for a meal the classifier named on every day', async () => {
      revise([0, 1, 2].map((dayIndex) => ({ ...mealTarget, dayIndex })));

      await expect(send('replace the dinner')).resolves.toEqual([
        {
          type: ChatStreamEventType.Clarification,
          message: menuTargetDayReply(MealType.Dinner, 3),
          missingFields: [MenuTargetField.DayIndex],
        },
        { type: ChatStreamEventType.Done },
      ]);
      expect(menuPlannerService.replan).not.toHaveBeenCalled();
    });

    it.each<[string, MenuTarget, string, string[]]>([
      [
        'a meal without a day',
        { ...mealTarget, dayIndex: null },
        menuTargetDayReply(MealType.Dinner, 3),
        [MenuTargetField.DayIndex],
      ],
      [
        'a day the menu does not have',
        { ...dayTarget, dayIndex: 5 },
        menuTargetMissingDayReply(3),
        [MenuTargetField.DayIndex],
      ],
      [
        'a meal of a day the menu does not have',
        { ...mealTarget, dayIndex: 3 },
        menuTargetMissingDayReply(3),
        [MenuTargetField.DayIndex],
      ],
      [
        'a meal the day does not have',
        { ...mealTarget, mealType: MealType.Snack },
        menuTargetMissingMealReply(MealType.Snack, ['breakfast', 'lunch', 'dinner']),
        [MenuTargetField.MealType],
      ],
    ])('asks about %s instead of planning', async (_case, target, message, missingFields) => {
      revise([dayTarget, target]);

      await expect(send('change it')).resolves.toEqual([
        { type: ChatStreamEventType.Clarification, message, missingFields },
        { type: ChatStreamEventType.Done },
      ]);
      expect(conversationService.addAssistantMessage).toHaveBeenCalledWith(
        CONVERSATION_ID,
        message,
        undefined,
      );
      expect(menuPlannerService.plan).not.toHaveBeenCalled();
      expect(menuPlannerService.replan).not.toHaveBeenCalled();
    });

    it.each<[string, MenuTarget[] | null, MenuRequest]>([
      ['no target', null, threeDays],
      ['no targets', [], threeDays],
      ['the menu', [{ scope: MenuTargetScope.Menu, dayIndex: null, mealType: null }], threeDays],
      [
        'a meal on every day',
        [dayTarget, { scope: MenuTargetScope.Menu, dayIndex: null, mealType: MealType.Dinner }],
        threeDays,
      ],
      ['every day', [0, 1, 2].map((dayIndex) => ({ ...dayTarget, dayIndex })), threeDays],
      ['a day with another number of days', [dayTarget], { ...threeDays, days: 5 }],
      ['a meal with another number of days', [mealTarget], { ...threeDays, days: 5 }],
    ])('plans the whole menu again for %s', async (_case, targets, menuRequest) => {
      revise(targets, menuRequest);

      await send('change it');

      expect(menuPlannerService.replan).not.toHaveBeenCalled();
      expect(menuPlannerService.plan).toHaveBeenCalled();
    });

    it('plans the whole menu when the chat suggested none yet', async () => {
      conversationService.getById.mockResolvedValue(conversation);
      revise([dayTarget]);

      await send('redo Tuesday');

      expect(menuService.getRevisionBase).not.toHaveBeenCalled();
      expect(menuPlannerService.plan).toHaveBeenCalled();
    });

    it('plans a day of a menu of the gathered number of days when the request names none', async () => {
      revise([dayTarget], { ...threeDays, days: null });

      await send('redo Tuesday');

      expect(menuPlannerService.replan).toHaveBeenCalled();
    });

    it('never plans single days for a new menu request', async () => {
      intentService.classify.mockResolvedValue({
        intent: Intent.GenerateMenu,
        request: 'Plan a 3-day menu.',
        menuRequest: threeDays,
        targets: [dayTarget],
      });

      await send('a new menu');

      expect(menuPlannerService.replan).not.toHaveBeenCalled();
    });
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

  describe('menu tools of the chat model', () => {
    const menuRequest: MenuRequest = {
      ...EMPTY_MENU_REQUEST,
      days: 2,
      mealTypes: [MealType.Lunch],
    };
    const callsTool = (call: ChatServiceCall): void => {
      classifyAs(Intent.GeneralChat);
      generalChatService.reply.mockImplementation(async function* () {
        yield 'Sure. ';
        return call;
      });
    };

    it('plans the menu plan_menu asks for on the path of a classified request and saves it', async () => {
      callsTool({
        name: ChatToolName.PlanMenu,
        input: { request: 'Plan a 2-day menu of lunches.', menuRequest },
      });

      await expect(send('Ok, go ahead')).resolves.toEqual([
        { type: ChatStreamEventType.TextDelta, content: 'Sure. ' },
        { type: ChatStreamEventType.TextDelta, content: 'Your day' },
        { type: ChatStreamEventType.MenuReady, ...saved, menu },
        { type: ChatStreamEventType.Done },
      ]);
      expect(conversationService.saveMenuRequest).toHaveBeenCalledWith(
        CONVERSATION_ID,
        menuRequest,
      );
      expect(menuPlannerService.plan).toHaveBeenCalledWith(
        'Plan a 2-day menu of lunches.',
        menuRequest,
        profile,
        undefined,
        expect.any(Function),
      );
      expect(menuService.saveGenerated).toHaveBeenCalledWith(
        conversation,
        expect.objectContaining({ menu, generatedWith }),
      );
      expect(conversationService.addAssistantMessage).toHaveBeenCalledWith(
        CONVERSATION_ID,
        'Sure. Your day',
        MENU_VERSION_ID,
      );
    });

    it('asks about the days the request cannot have instead of planning, as without tools', async () => {
      callsTool({
        name: ChatToolName.PlanMenu,
        input: { request: 'Plan a 30-day menu.', menuRequest: { ...menuRequest, days: 30 } },
      });

      const events = await send();

      expect(events).toContainEqual({
        type: ChatStreamEventType.Clarification,
        message: daysOutOfRangeReply(30, MENU_MAX_DAYS),
        missingFields: ['days'],
      });
      expect(menuPlannerService.plan).not.toHaveBeenCalled();
      expect(menuService.saveGenerated).not.toHaveBeenCalled();
    });

    it('plans a new menu for revise_menu when the chat suggested none yet (resolveIntent)', async () => {
      callsTool({
        name: ChatToolName.ReviseMenu,
        input: {
          request: 'Plan a 2-day menu of lunches without fish.',
          menuRequest,
          targets: [{ scope: MenuTargetScope.Menu, dayIndex: null, mealType: null }],
        },
      });

      await send();

      expect(menuPlannerService.plan).toHaveBeenCalledWith(
        'Plan a 2-day menu of lunches without fish.',
        menuRequest,
        profile,
        undefined,
        expect.any(Function),
      );
      expect(menuPlannerService.replan).not.toHaveBeenCalled();
    });

    it('answers with the chat text alone when the model called no menu tool', async () => {
      classifyAs(Intent.GeneralChat);

      await send();

      expect(menuPlannerService.plan).not.toHaveBeenCalled();
      expect(conversationService.saveMenuRequest).not.toHaveBeenCalled();
    });
  });

  describe('tool steps and trace', () => {
    const toolCall = {
      name: ChatToolName.SearchRecipes,
      input: { query: 'soup' },
      output: { recipes: [] },
      error: null,
      durationMs: 3,
    };
    const searching = { type: ChatStreamEventType.Status, step: ChatStatusStep.SearchingRecipes };
    const planCall: ChatServiceCall = {
      name: ChatToolName.PlanMenu,
      input: { request: 'Plan a 1-day menu.', menuRequest: { ...EMPTY_MENU_REQUEST, days: 1 } },
    };

    it('streams the status of a chat tool as a transient step, outside the saved reply', async () => {
      classifyAs(Intent.GeneralChat);
      generalChatService.reply.mockImplementation(async function* () {
        yield searching as ChatProgressEvent;
        yield 'Found it.';
        return null;
      });

      await expect(sendAll()).resolves.toEqual([
        { type: ChatStreamEventType.Status, step: ChatStatusStep.Thinking },
        searching,
        { type: ChatStreamEventType.TextDelta, content: 'Found it.' },
        { type: ChatStreamEventType.Done },
      ]);
      expect(conversationService.addAssistantMessage).toHaveBeenCalledWith(
        CONVERSATION_ID,
        'Found it.',
        undefined,
      );
    });

    it('traces the whole chain of a message once it is answered', async () => {
      classifyAs(Intent.GeneralChat);
      generalChatService.reply.mockImplementation(
        async function* (_history, _request, _profile, _signal, onToolCall) {
          yield searching as ChatProgressEvent;
          onToolCall!(toolCall);
          return planCall;
        },
      );

      await send('Plan me a day');

      expect(traces).toHaveLength(1);
      const [record] = traces;
      expect(record).toMatchObject({
        conversationId: CONVERSATION_ID,
        request: { content: 'Plan me a day' },
        outcome: ChatTraceOutcome.Replied,
        durationMs: expect.any(Number),
      });
      expect(record.steps.map(({ step }) => step)).toEqual([
        ChatTraceStep.Event,
        ChatTraceStep.Context,
        ChatTraceStep.Intent,
        ChatTraceStep.MenuRequest,
        ChatTraceStep.Route,
        ChatTraceStep.Event,
        ChatTraceStep.ToolCall,
        ChatTraceStep.ServiceCall,
        ChatTraceStep.MenuRequest,
        ChatTraceStep.Route,
        ChatTraceStep.MenuPlan,
        ChatTraceStep.Event,
        ChatTraceStep.Saved,
      ]);
      const data = (step: ChatTraceStep): unknown[] =>
        record.steps.filter((entry) => entry.step === step).map((entry) => entry.data);
      expect(data(ChatTraceStep.Context)[0]).toMatchObject({
        profile,
        menuRequest: null,
        summary: 'Rejected the salmon.',
        messages: [expect.objectContaining({ role: MessageRole.User })],
      });
      expect(data(ChatTraceStep.Intent)).toEqual([
        { intent: Intent.GeneralChat, request: null, menuRequest: null, targets: null },
      ]);
      expect(data(ChatTraceStep.ToolCall)).toEqual([toolCall]);
      expect(data(ChatTraceStep.ServiceCall)).toEqual([
        { call: planCall, intent: expect.objectContaining({ intent: Intent.GenerateMenu }) },
      ]);
      expect(data(ChatTraceStep.MenuPlan)).toEqual([
        {
          request: 'Plan a 1-day menu.',
          revision: null,
          response: expect.objectContaining({ type: ChatResponseType.MenuReady, generatedWith }),
        },
      ]);
      // The menu itself is left out of the event: the plan step has it.
      expect(data(ChatTraceStep.Event).at(-1)).toEqual({
        type: ChatStreamEventType.MenuReady,
        ...saved,
      });
      expect(data(ChatTraceStep.Saved)).toEqual([
        { content: 'Your day', menuVersionId: MENU_VERSION_ID },
      ]);
    });

    it('traces a failure with its error and the event the client got', async () => {
      jest.spyOn(service['logger'], 'error').mockImplementation();
      classifyAs(Intent.GeneralChat);
      generalChatService.reply.mockImplementation(async function* () {
        yield* [];
        throw new Error('db down');
      });

      await send();

      expect(traces[0].outcome).toBe(ChatTraceOutcome.Failed);
      expect(traces[0].steps.slice(-2)).toEqual([
        expect.objectContaining({
          step: ChatTraceStep.Error,
          data: expect.objectContaining({ name: 'Error', message: 'db down' }),
        }),
        expect.objectContaining({
          step: ChatTraceStep.Event,
          data: expect.objectContaining({ code: ChatErrorCode.InternalError }),
        }),
      ]);
    });

    it('ends the trace of a reply the client left as aborted', async () => {
      classifyAs(Intent.GeneralChat);
      const abort = new AbortController();
      generalChatService.reply.mockImplementation(async function* () {
        yield 'A ';
        abort.abort();
        throw new Error('aborted');
      });

      await send('Hi', abort.signal);

      expect(traces.map(({ outcome }) => outcome)).toEqual([ChatTraceOutcome.Aborted]);
    });

    it('traces a full conversation as limit reached', async () => {
      conversationService.getById.mockResolvedValue(
        buildConversation({
          messages: Array.from({ length: CONVERSATION_MAX_USER_MESSAGES }, () => buildMessage()),
        }),
      );

      await send();

      expect(traces.map(({ outcome }) => outcome)).toEqual([ChatTraceOutcome.LimitReached]);
    });
  });

  describe('context budget', () => {
    it('gives the classifier the menu request the chat gathered', async () => {
      const stored = { ...EMPTY_MENU_REQUEST, days: 3, excludedIngredients: ['mushrooms'] };
      conversationService.getMenuRequest.mockReturnValue(stored);
      classifyAs(Intent.GeneralChat);

      await send();

      expect(intentService.classify).toHaveBeenCalledWith(history, stored, profile, undefined);
      expect(generalChatService.reply).toHaveBeenCalledWith(
        history,
        stored,
        profile,
        undefined,
        expect.any(Function),
      );
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
