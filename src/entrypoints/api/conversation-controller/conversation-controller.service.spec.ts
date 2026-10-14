import { ChatService } from '../../../modules/services/chat/chat.service';
import { createMock } from '../../../test/create-mock';
import { buildConversation, CONVERSATION_ID, MENU_ID } from '../../../test/fixtures';
import { ConversationControllerService } from './conversation-controller.service';

describe('ConversationControllerService', () => {
  let chatService: jest.Mocked<ChatService>;
  let service: ConversationControllerService;
  const conversation = buildConversation();

  beforeEach(() => {
    chatService = createMock<ChatService>();
    for (const method of ['getById', 'create', 'update', 'sendMessage'] as const) {
      chatService[method].mockResolvedValue(conversation);
    }
    service = new ConversationControllerService(chatService);
  });

  it('maps the list', async () => {
    const { messages: _messages, ...summary } = conversation;
    chatService.getAll.mockResolvedValue([{ ...summary, _count: { messages: 2 } }]);

    await expect(service.getAll()).resolves.toEqual([
      expect.objectContaining({ id: CONVERSATION_ID, messageCount: 2 }),
    ]);
  });

  it('maps one conversation for every call that returns it', async () => {
    const expected = expect.objectContaining({ id: CONVERSATION_ID, messages: [] });

    await expect(service.getById(CONVERSATION_ID)).resolves.toEqual(expected);
    await expect(service.create({ menuId: MENU_ID })).resolves.toEqual(expected);
    await expect(service.update(CONVERSATION_ID, { title: 'T' })).resolves.toEqual(expected);
    await expect(service.sendMessage(CONVERSATION_ID, { content: 'Hi' })).resolves.toEqual(
      expected,
    );

    expect(chatService.create).toHaveBeenCalledWith({ menuId: MENU_ID });
    expect(chatService.update).toHaveBeenCalledWith(CONVERSATION_ID, { title: 'T' });
    expect(chatService.sendMessage).toHaveBeenCalledWith(CONVERSATION_ID, 'Hi');
  });

  it('deletes', async () => {
    await service.delete(CONVERSATION_ID);

    expect(chatService.delete).toHaveBeenCalledWith(CONVERSATION_ID);
  });
});
