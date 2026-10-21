import {
  ASSISTANT_INVALID_OUTPUT_REPLY,
  ASSISTANT_UNAVAILABLE_REPLY,
  CLARIFICATION_MISSING_FIELDS,
  CLARIFICATION_REPLY,
  ChatResponseType,
  Goal,
  ChatStreamEventType,
  INTERNAL_ERROR_REPLY,
  Intent,
  OUT_OF_SCOPE_REPLY,
} from '../../../common/constants';
import { ChatStreamEvent, MenuComposition, ProfileContext } from '../../../common/types';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
  ConversationNotFoundException,
} from '../../../common/exceptions';
import { createMock } from '../../../test/create-mock';
import { buildConversation, CONVERSATION_ID, PROFILE_ID } from '../../../test/fixtures';
import { ConversationService } from '../conversation/conversation.service';
import { GeneralChatService } from '../general-chat/general-chat.service';
import { IntentService } from '../intent/intent.service';
import { MenuPlannerService } from '../menu/menu-planner.service';
import { ProfileContextService } from '../profile-context/profile-context.service';
import { ChatOrchestratorService } from './chat-orchestrator.service';

describe('ChatOrchestratorService', () => {
  let conversationService: jest.Mocked<ConversationService>;
  let intentService: jest.Mocked<IntentService>;
  let generalChatService: jest.Mocked<GeneralChatService>;
  let menuPlannerService: jest.Mocked<MenuPlannerService>;
  let profileContextService: jest.Mocked<ProfileContextService>;
  let service: ChatOrchestratorService;
  const conversation = buildConversation();
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
  const send = async (content = 'Hi', signal?: AbortSignal): Promise<ChatStreamEvent[]> =>
    collect(await service.handleMessage(CONVERSATION_ID, content, signal));
  const classifyAs = (intent: Intent, request: string | null = null): void => {
    intentService.classify.mockResolvedValue({ intent, request });
  };

  beforeEach(() => {
    conversationService = createMock<ConversationService>();
    conversationService.getById.mockResolvedValue(conversation);
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
    });
    profileContextService = createMock<ProfileContextService>();
    profileContextService.find.mockResolvedValue(profile);
    service = new ChatOrchestratorService(
      conversationService,
      intentService,
      generalChatService,
      menuPlannerService,
      profileContextService,
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
    expect(intentService.classify).toHaveBeenCalledWith(CONVERSATION_ID, profile, abort.signal);
    expect(generalChatService.reply).toHaveBeenCalledWith(CONVERSATION_ID, profile, abort.signal);
    expect(conversationService.addAssistantMessage).toHaveBeenCalledWith(
      CONVERSATION_ID,
      'A reply',
      undefined,
    );
    expect(menuPlannerService.plan).not.toHaveBeenCalled();
  });

  it('hands the restated request to MenuPlannerService and saves the message with the menu', async () => {
    classifyAs(Intent.GenerateMenu, 'Plan a one-day menu.');
    const abort = new AbortController();

    await expect(send('done do it again', abort.signal)).resolves.toEqual([
      { type: ChatStreamEventType.TextDelta, content: 'Your day' },
      { type: ChatStreamEventType.MenuReady, menu },
      { type: ChatStreamEventType.Done },
    ]);
    expect(profileContextService.find).toHaveBeenCalledTimes(1);
    expect(intentService.classify).toHaveBeenCalledWith(CONVERSATION_ID, profile, abort.signal);
    expect(menuPlannerService.plan).toHaveBeenCalledWith(
      'Plan a one-day menu.',
      profile,
      abort.signal,
    );
    expect(conversationService.addAssistantMessage).toHaveBeenCalledWith(
      CONVERSATION_ID,
      'Your day',
      menu,
    );
    expect(generalChatService.reply).not.toHaveBeenCalled();
  });

  it('plans from the message itself when the classifier restated no request', async () => {
    classifyAs(Intent.GenerateMenu);

    await send('Plan a day');

    expect(menuPlannerService.plan).toHaveBeenCalledWith('Plan a day', profile, undefined);
  });

  it('passes a missing profile on as null', async () => {
    profileContextService.find.mockResolvedValue(null);
    classifyAs(Intent.GenerateMenu);

    await send('Plan a day');

    expect(intentService.classify).toHaveBeenCalledWith(CONVERSATION_ID, null, undefined);
    expect(menuPlannerService.plan).toHaveBeenCalledWith('Plan a day', null, undefined);
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
        missingFields: CLARIFICATION_MISSING_FIELDS,
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
});
