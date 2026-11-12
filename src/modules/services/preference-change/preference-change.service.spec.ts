import {
  MessageRole,
  PreferenceChangeAction,
  PreferenceChangeStatus,
  PreferenceType,
} from '../../../common/constants';
import {
  AllergyRemovalInChatBadRequestException,
  ConversationNotFoundException,
  PreferenceChangeNotFoundException,
  PreferenceChangeOutdatedConflictException,
  UnknownDietBadRequestException,
} from '../../../common/exceptions';
import { createMock } from '../../../test/create-mock';
import { buildConversation, buildMessage, CONVERSATION_ID } from '../../../test/fixtures';
import { ConversationService } from '../conversation/conversation.service';
import { DietaryPreferenceService } from '../dietary-preference/dietary-preference.service';
import { PreferenceChangeService } from './preference-change.service';

describe('PreferenceChangeService', () => {
  let conversationService: jest.Mocked<ConversationService>;
  let dietaryPreferenceService: jest.Mocked<DietaryPreferenceService>;
  let service: PreferenceChangeService;
  const change = {
    action: PreferenceChangeAction.Add,
    preferenceType: PreferenceType.Allergy,
    value: 'peanut',
  };
  const proposed = buildMessage({ role: MessageRole.Assistant, preferenceChange: change });

  beforeEach(() => {
    conversationService = createMock<ConversationService>();
    dietaryPreferenceService = createMock<DietaryPreferenceService>();
    service = new PreferenceChangeService(conversationService, dietaryPreferenceService);
  });

  describe('propose', () => {
    it('proposes the checked change and writes nothing', async () => {
      dietaryPreferenceService.checkChange.mockResolvedValue({ change, inEffect: false });

      await expect(service.propose({ ...change, value: 'Peanut' })).resolves.toEqual({
        status: PreferenceChangeStatus.Proposed,
        change,
      });
      expect(dietaryPreferenceService.applyChange).not.toHaveBeenCalled();
    });

    it('proposes nothing for a change in effect already', async () => {
      dietaryPreferenceService.checkChange.mockResolvedValue({ change, inEffect: true });

      await expect(service.propose(change)).resolves.toEqual({
        status: PreferenceChangeStatus.AlreadyApplied,
        change,
      });
    });

    it('passes on a change the preferences refuse', async () => {
      dietaryPreferenceService.checkChange.mockRejectedValue(
        new UnknownDietBadRequestException('carnivore'),
      );

      await expect(service.propose(change)).rejects.toBeInstanceOf(UnknownDietBadRequestException);
    });
  });

  describe('applyInChat', () => {
    it('applies the change the latest reply proposed', async () => {
      conversationService.getById.mockResolvedValue(
        buildConversation({ messages: [buildMessage(), proposed, buildMessage()] }),
      );
      dietaryPreferenceService.applyChange.mockResolvedValue(PreferenceChangeStatus.Applied);

      await expect(service.applyInChat(CONVERSATION_ID)).resolves.toEqual({
        status: PreferenceChangeStatus.Applied,
        change,
      });
      expect(conversationService.getById).toHaveBeenCalledWith(CONVERSATION_ID);
      expect(dietaryPreferenceService.applyChange).toHaveBeenCalledWith(change);
    });

    it('applies nothing once a later reply proposed nothing', async () => {
      conversationService.getById.mockResolvedValue(
        buildConversation({
          messages: [proposed, buildMessage(), buildMessage({ role: MessageRole.Assistant })],
        }),
      );

      await expect(service.applyInChat(CONVERSATION_ID)).rejects.toBeInstanceOf(
        PreferenceChangeNotFoundException,
      );
      expect(dietaryPreferenceService.applyChange).not.toHaveBeenCalled();
    });

    it('leaves the removal of an allergy to the confirm button', async () => {
      const removal = { ...change, action: PreferenceChangeAction.Remove };
      conversationService.getById.mockResolvedValue(
        buildConversation({
          messages: [buildMessage({ role: MessageRole.Assistant, preferenceChange: removal })],
        }),
      );

      await expect(service.applyInChat(CONVERSATION_ID)).rejects.toBeInstanceOf(
        AllergyRemovalInChatBadRequestException,
      );
      expect(dietaryPreferenceService.applyChange).not.toHaveBeenCalled();
    });

    it('applies the removal of another preference', async () => {
      const removal = {
        action: PreferenceChangeAction.Remove,
        preferenceType: PreferenceType.DislikedFood,
        value: 'fish',
      };
      conversationService.getById.mockResolvedValue(
        buildConversation({
          messages: [buildMessage({ role: MessageRole.Assistant, preferenceChange: removal })],
        }),
      );
      dietaryPreferenceService.applyChange.mockResolvedValue(PreferenceChangeStatus.Applied);

      await expect(service.applyInChat(CONVERSATION_ID)).resolves.toEqual({
        status: PreferenceChangeStatus.Applied,
        change: removal,
      });
    });

    it('fails for a conversation of another profile', async () => {
      conversationService.getById.mockRejectedValue(new ConversationNotFoundException());

      await expect(service.applyInChat(CONVERSATION_ID)).rejects.toBeInstanceOf(
        ConversationNotFoundException,
      );
    });
  });

  describe('confirm', () => {
    beforeEach(() => {
      conversationService.getById.mockResolvedValue(
        buildConversation({ messages: [buildMessage(), proposed] }),
      );
      dietaryPreferenceService.applyChange.mockResolvedValue(PreferenceChangeStatus.Applied);
    });

    it('applies the pending change the client confirmed, compared as it is saved', async () => {
      await expect(
        service.confirm(CONVERSATION_ID, { ...change, value: ' Peanut ' }),
      ).resolves.toEqual({ status: PreferenceChangeStatus.Applied, change });
      expect(dietaryPreferenceService.applyChange).toHaveBeenCalledWith(change);
    });

    it('applies the removal of an allergy', async () => {
      const removal = { ...change, action: PreferenceChangeAction.Remove };
      conversationService.getById.mockResolvedValue(
        buildConversation({
          messages: [buildMessage({ role: MessageRole.Assistant, preferenceChange: removal })],
        }),
      );

      await expect(service.confirm(CONVERSATION_ID, removal)).resolves.toEqual({
        status: PreferenceChangeStatus.Applied,
        change: removal,
      });
    });

    it.each([
      ['value', { ...change, value: 'milk' }],
      ['action', { ...change, action: PreferenceChangeAction.Remove }],
      ['type', { ...change, preferenceType: PreferenceType.DislikedFood }],
    ])('refuses a change with another %s than the pending one', async (_, confirmed) => {
      await expect(service.confirm(CONVERSATION_ID, confirmed)).rejects.toBeInstanceOf(
        PreferenceChangeOutdatedConflictException,
      );
      expect(dietaryPreferenceService.applyChange).not.toHaveBeenCalled();
    });

    it('fails when no change is pending', async () => {
      conversationService.getById.mockResolvedValue(buildConversation({ messages: [] }));

      await expect(service.confirm(CONVERSATION_ID, change)).rejects.toBeInstanceOf(
        PreferenceChangeNotFoundException,
      );
    });
  });
});
