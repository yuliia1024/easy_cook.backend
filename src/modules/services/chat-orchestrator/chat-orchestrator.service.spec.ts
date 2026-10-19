import {
  ASSISTANT_UNAVAILABLE_REPLY,
  CLARIFICATION_MISSING_FIELDS,
  CLARIFICATION_REPLY,
  INTERNAL_ERROR_REPLY,
  Intent,
  MENU_PLANNER_STUB_REPLY,
  OUT_OF_SCOPE_REPLY,
} from '../../../common/constants';
import { ChatStreamEvent } from '../../../common/contracts';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
  ConversationNotFoundException,
} from '../../../common/exceptions';
import { createMock } from '../../../test/create-mock';
import { buildConversation, CONVERSATION_ID } from '../../../test/fixtures';
import { ConversationService } from '../conversation/conversation.service';
import { GeneralChatService } from '../general-chat/general-chat.service';
import { IntentService } from '../intent/intent.service';
import { MenuPlannerService } from '../menu/menu-planner.service';
import { ChatOrchestratorService } from './chat-orchestrator.service';

describe('ChatOrchestratorService', () => {
  let conversationService: jest.Mocked<ConversationService>;
  let intentService: jest.Mocked<IntentService>;
  let generalChatService: jest.Mocked<GeneralChatService>;
  let menuPlannerService: jest.Mocked<MenuPlannerService>;
  let service: ChatOrchestratorService;
  const conversation = buildConversation();

  const collect = async (stream: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> => {
    const events: ChatStreamEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    return events;
  };
  const send = async (content = 'Hi', signal?: AbortSignal): Promise<ChatStreamEvent[]> =>
    collect(await service.handleMessage(CONVERSATION_ID, content, signal));
  const classifyAs = (intent: Intent): void => {
    intentService.classify.mockResolvedValue({ intent });
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
    menuPlannerService.plan.mockResolvedValue({ type: 'text', message: MENU_PLANNER_STUB_REPLY });
    service = new ChatOrchestratorService(
      conversationService,
      intentService,
      generalChatService,
      menuPlannerService,
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
      { type: 'text_delta', content: 'A ' },
      { type: 'text_delta', content: 'reply' },
      { type: 'done' },
    ]);
    expect(intentService.classify).toHaveBeenCalledWith('Hello there', abort.signal);
    expect(generalChatService.reply).toHaveBeenCalledWith(CONVERSATION_ID, abort.signal);
    expect(conversationService.addAssistantMessage).toHaveBeenCalledWith(
      CONVERSATION_ID,
      'A reply',
    );
    expect(menuPlannerService.plan).not.toHaveBeenCalled();
  });

  it('hands a menu request to MenuPlannerService', async () => {
    classifyAs(Intent.GenerateMenu);

    await expect(send('Plan 3 days')).resolves.toEqual([
      { type: 'text_delta', content: MENU_PLANNER_STUB_REPLY },
      { type: 'done' },
    ]);
    expect(menuPlannerService.plan).toHaveBeenCalledWith('Plan 3 days');
    expect(generalChatService.reply).not.toHaveBeenCalled();
  });

  it('passes a planner clarification or error through', async () => {
    classifyAs(Intent.GenerateMenu);
    const error = { type: 'error', code: 'x', message: 'No', retryable: false } as const;
    menuPlannerService.plan.mockResolvedValue(error);

    await expect(send()).resolves.toEqual([error, { type: 'done' }]);
    expect(conversationService.addAssistantMessage).not.toHaveBeenCalled();
  });

  it('asks for clarification without the model or menu generation', async () => {
    classifyAs(Intent.Clarification);

    await expect(send('Make a menu')).resolves.toEqual([
      {
        type: 'clarification',
        message: CLARIFICATION_REPLY,
        missingFields: CLARIFICATION_MISSING_FIELDS,
      },
      { type: 'done' },
    ]);
    expect(generalChatService.reply).not.toHaveBeenCalled();
    expect(menuPlannerService.plan).not.toHaveBeenCalled();
    expect(conversationService.addAssistantMessage).toHaveBeenCalledWith(
      CONVERSATION_ID,
      CLARIFICATION_REPLY,
    );
  });

  it('answers an unrelated request with the fixed reply', async () => {
    classifyAs(Intent.OutOfScope);

    await expect(send('Write a poem')).resolves.toEqual([
      { type: 'text_delta', content: OUT_OF_SCOPE_REPLY },
      { type: 'done' },
    ]);
    expect(generalChatService.reply).not.toHaveBeenCalled();
    expect(menuPlannerService.plan).not.toHaveBeenCalled();
  });

  it.each([
    [new AssistantUnavailableException(false), false],
    [new AssistantInvalidOutputException(), true],
  ])('turns a classification failure (%p) into an error event', async (error, retryable) => {
    intentService.classify.mockRejectedValue(error);

    await expect(send()).resolves.toEqual([
      {
        type: 'error',
        code: 'assistant_unavailable',
        message: ASSISTANT_UNAVAILABLE_REPLY,
        retryable,
      },
      { type: 'done' },
    ]);
    expect(generalChatService.reply).not.toHaveBeenCalled();
    expect(menuPlannerService.plan).not.toHaveBeenCalled();
    expect(conversationService.addAssistantMessage).not.toHaveBeenCalled();
  });

  it('does not save a reply that failed midway and hides unexpected errors', async () => {
    jest.spyOn(service['logger'], 'error').mockImplementation();
    classifyAs(Intent.GeneralChat);
    generalChatService.reply.mockImplementation(async function* () {
      yield 'A ';
      throw new Error('secret internals');
    });

    const events = await send();

    expect(events.slice(1)).toEqual([
      { type: 'error', code: 'internal_error', message: INTERNAL_ERROR_REPLY, retryable: false },
      { type: 'done' },
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
      { type: 'text_delta', content: 'A ' },
    ]);
    expect(conversationService.addAssistantMessage).not.toHaveBeenCalled();
  });
});
