import { createMock } from '../../../test/create-mock';
import { CONVERSATION_ID } from '../../../test/fixtures';
import { ConversationControllerService } from './conversation-controller.service';
import { ConversationController } from './conversation.controller';

describe('ConversationController', () => {
  it('delegates to the service', async () => {
    const service = createMock<ConversationControllerService>();
    const controller = new ConversationController(service);

    await controller.getAll();
    await controller.getById(CONVERSATION_ID);
    await controller.create({ title: 'T' });
    await controller.update(CONVERSATION_ID, { menuId: null });
    await controller.delete(CONVERSATION_ID);
    await controller.sendMessage(CONVERSATION_ID, { content: 'Hi' });

    expect(service.getAll).toHaveBeenCalled();
    expect(service.getById).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(service.create).toHaveBeenCalledWith({ title: 'T' });
    expect(service.update).toHaveBeenCalledWith(CONVERSATION_ID, { menuId: null });
    expect(service.delete).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(service.sendMessage).toHaveBeenCalledWith(CONVERSATION_ID, { content: 'Hi' });
  });
});
