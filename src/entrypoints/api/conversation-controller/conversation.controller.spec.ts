import { pipeUIMessageStreamToResponse } from 'ai';
import { Response } from 'express';
import { createMock } from '../../../test/create-mock';
import { CONVERSATION_ID } from '../../../test/fixtures';
import { ConversationControllerService } from './conversation-controller.service';
import { ConversationController } from './conversation.controller';

jest.mock('ai', () => ({ pipeUIMessageStreamToResponse: jest.fn() }));

describe('ConversationController', () => {
  it('delegates to the service', async () => {
    const service = createMock<ConversationControllerService>();
    const controller = new ConversationController(service);

    await controller.getAll();
    await controller.getById(CONVERSATION_ID);
    await controller.create({ title: 'T' });
    await controller.update(CONVERSATION_ID, { menuId: null });
    await controller.delete(CONVERSATION_ID);
    await controller.sendMessage(CONVERSATION_ID, { content: 'Hi' }, createMock<Response>());

    expect(service.getAll).toHaveBeenCalled();
    expect(service.getById).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(service.create).toHaveBeenCalledWith({ title: 'T' });
    expect(service.update).toHaveBeenCalledWith(CONVERSATION_ID, { menuId: null });
    expect(service.delete).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(service.sendMessage).toHaveBeenCalledWith(CONVERSATION_ID, { content: 'Hi' });
  });

  it('pipes the reply stream to the response with 201', async () => {
    const service = createMock<ConversationControllerService>();
    const stream = new ReadableStream();
    service.sendMessage.mockResolvedValue(stream);
    const response = createMock<Response>();

    await new ConversationController(service).sendMessage(
      CONVERSATION_ID,
      { content: 'Hi' },
      response,
    );

    expect(pipeUIMessageStreamToResponse).toHaveBeenCalledWith({ response, status: 201, stream });
  });
});
