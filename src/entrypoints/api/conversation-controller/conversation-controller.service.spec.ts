import { UIMessageChunk } from 'ai';
import { ChatOrchestratorService } from '../../../modules/services/chat-orchestrator/chat-orchestrator.service';
import { ConversationService } from '../../../modules/services/conversation/conversation.service';
import { createMock } from '../../../test/create-mock';
import { buildConversation, CONVERSATION_ID, MENU_ID } from '../../../test/fixtures';
import { ConversationControllerService } from './conversation-controller.service';

describe('ConversationControllerService', () => {
  let conversationService: jest.Mocked<ConversationService>;
  let chatOrchestratorService: jest.Mocked<ChatOrchestratorService>;
  let service: ConversationControllerService;
  const conversation = buildConversation();

  beforeEach(() => {
    conversationService = createMock<ConversationService>();
    for (const method of ['getById', 'create', 'update'] as const) {
      conversationService[method].mockResolvedValue(conversation);
    }
    chatOrchestratorService = createMock<ChatOrchestratorService>();
    service = new ConversationControllerService(conversationService, chatOrchestratorService);
  });

  it('maps the list', async () => {
    const { messages: _messages, ...summary } = conversation;
    conversationService.getAll.mockResolvedValue([{ ...summary, _count: { messages: 2 } }]);

    await expect(service.getAll()).resolves.toEqual([
      expect.objectContaining({ id: CONVERSATION_ID, messageCount: 2 }),
    ]);
  });

  it('maps one conversation for every call that returns it', async () => {
    const expected = expect.objectContaining({ id: CONVERSATION_ID, messages: [] });

    await expect(service.getById(CONVERSATION_ID)).resolves.toEqual(expected);
    await expect(service.create({ menuId: MENU_ID })).resolves.toEqual(expected);
    await expect(service.update(CONVERSATION_ID, { title: 'T' })).resolves.toEqual(expected);

    expect(conversationService.create).toHaveBeenCalledWith({ menuId: MENU_ID });
    expect(conversationService.update).toHaveBeenCalledWith(CONVERSATION_ID, { title: 'T' });
  });

  it('streams the chat reply as UI message chunks', async () => {
    chatOrchestratorService.handleMessage.mockResolvedValue(
      (async function* () {
        yield { type: 'text_delta' as const, content: 'Hello' };
        yield { type: 'done' as const };
      })(),
    );
    const abort = new AbortController();

    const stream = await service.sendMessage(CONVERSATION_ID, { content: 'Hi' }, abort.signal);
    const chunks: UIMessageChunk[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<UIMessageChunk>) {
      chunks.push(chunk);
    }

    expect(chatOrchestratorService.handleMessage).toHaveBeenCalledWith(
      CONVERSATION_ID,
      'Hi',
      abort.signal,
    );
    expect(chunks).toContainEqual({ type: 'text-delta', id: 'text', delta: 'Hello' });
  });

  it('deletes', async () => {
    await service.delete(CONVERSATION_ID);

    expect(conversationService.delete).toHaveBeenCalledWith(CONVERSATION_ID);
  });
});
