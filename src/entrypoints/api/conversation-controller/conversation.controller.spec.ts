import { pipeUIMessageStreamToResponse } from 'ai';
import { Response } from 'express';
import { PreferenceChangeAction, PreferenceType } from '../../../common/constants';
import { createMock } from '../../../test/create-mock';
import { CONVERSATION_ID } from '../../../test/fixtures';
import { ConversationControllerService } from './conversation-controller.service';
import { ConversationController } from './conversation.controller';

jest.mock('ai', () => ({ pipeUIMessageStreamToResponse: jest.fn() }));

const CHANGE = {
  action: PreferenceChangeAction.Add,
  preferenceType: PreferenceType.Allergy,
  value: 'peanut',
};

describe('ConversationController', () => {
  it('delegates to the service', async () => {
    const service = createMock<ConversationControllerService>();
    const controller = new ConversationController(service);

    await controller.getAll();
    await controller.getById(CONVERSATION_ID);
    await controller.create({ title: 'T' });
    await controller.update(CONVERSATION_ID, { menuId: null });
    await controller.delete(CONVERSATION_ID);
    await controller.confirmPreferenceChange(CONVERSATION_ID, CHANGE);
    await controller.sendMessage(CONVERSATION_ID, { content: 'Hi' }, createMock<Response>());

    expect(service.getAll).toHaveBeenCalled();
    expect(service.getById).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(service.create).toHaveBeenCalledWith({ title: 'T' });
    expect(service.update).toHaveBeenCalledWith(CONVERSATION_ID, { menuId: null });
    expect(service.delete).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(service.confirmPreferenceChange).toHaveBeenCalledWith(CONVERSATION_ID, CHANGE);
    expect(service.sendMessage).toHaveBeenCalledWith(
      CONVERSATION_ID,
      { content: 'Hi' },
      expect.any(AbortSignal),
    );
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

  it.each([
    [false, true],
    [true, false],
  ])(
    'aborts the reply when the client disconnects (finished: %p)',
    async (writableFinished, aborted) => {
      const service = createMock<ConversationControllerService>();
      service.sendMessage.mockResolvedValue(new ReadableStream());
      const response = createMock<Response>({ writableFinished });

      await new ConversationController(service).sendMessage(
        CONVERSATION_ID,
        { content: 'Hi' },
        response,
      );
      const [event, onClose] = response.on.mock.calls[0] as unknown as [string, () => void];
      onClose();

      expect(event).toBe('close');
      expect(service.sendMessage.mock.calls[0][2]?.aborted).toBe(aborted);
    },
  );
});
