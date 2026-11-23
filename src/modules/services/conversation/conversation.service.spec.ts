import {
  MealType,
  MESSAGE_MAX_LENGTH,
  MessageRole,
  MODEL_HISTORY_MAX_TOKENS,
  PreferenceChangeAction,
  PreferenceType,
  ChatToolErrorCode,
} from '../../../common/constants';
import { ConversationNotFoundException, MenuNotFoundException } from '../../../common/exceptions';
import { createMock } from '../../../test/create-mock';
import {
  buildConversation,
  buildMenu,
  buildMenuVersion,
  buildMessage,
  buildProfile,
  CONVERSATION_ID,
  MENU_ID,
  MENU_VERSION_ID,
  PROFILE_ID,
} from '../../../test/fixtures';
import { ConversationRepository } from '../../data-access/conversation/conversation.repository';
import { MenuService } from '../menu/menu.service';
import { UserProfileService } from '../user-profile/user-profile.service';
import { ConversationService } from './conversation.service';
import { historyTokens } from './model-messages';

describe('ConversationService', () => {
  let repository: jest.Mocked<ConversationRepository>;
  let menuService: jest.Mocked<MenuService>;
  let service: ConversationService;
  const conversation = buildConversation();
  const menu = buildMenu({ versions: [buildMenuVersion()] });

  beforeEach(() => {
    repository = createMock<ConversationRepository>();
    repository.findById.mockResolvedValue(conversation);
    repository.addMessage.mockResolvedValue(buildMessage({ id: 'msg-new' }));
    const profileService = createMock<UserProfileService>();
    profileService.getCurrent.mockResolvedValue(buildProfile());
    menuService = createMock<MenuService>();
    menuService.getById.mockResolvedValue(menu);
    service = new ConversationService(repository, profileService, menuService);
  });

  it('lists the profile conversations', async () => {
    repository.findAll.mockResolvedValue([]);

    await expect(service.getAll()).resolves.toEqual([]);
    expect(repository.findAll).toHaveBeenCalledWith(PROFILE_ID);
  });

  describe('getById', () => {
    it('returns a conversation of the profile', async () => {
      await expect(service.getById(CONVERSATION_ID)).resolves.toBe(conversation);
      expect(repository.findById).toHaveBeenCalledWith(PROFILE_ID, CONVERSATION_ID);
    });

    it('fails for an unknown conversation', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.getById(CONVERSATION_ID)).rejects.toBeInstanceOf(
        ConversationNotFoundException,
      );
    });
  });

  describe('create', () => {
    it('starts an untitled conversation', async () => {
      repository.create.mockResolvedValue(conversation);

      await expect(service.create({})).resolves.toBe(conversation);
      expect(repository.create).toHaveBeenCalledWith(PROFILE_ID, {
        title: 'New conversation',
        menuId: null,
        menuRequest: null,
      });
      expect(menuService.getById).not.toHaveBeenCalled();
    });

    it('checks the menu belongs to the profile', async () => {
      await service.create({ title: 'About week 1', menuId: MENU_ID });

      expect(menuService.getById).toHaveBeenCalledWith(MENU_ID);
      expect(repository.create).toHaveBeenCalledWith(PROFILE_ID, {
        title: 'About week 1',
        menuId: MENU_ID,
        menuRequest: null,
      });
    });

    it('carries the menu request and the menu of another conversation, never its messages', async () => {
      const menuRequest = {
        days: 3,
        mealTypes: [],
        caloriesKcal: null,
        diets: [],
        excludedIngredients: ['mushrooms'],
        dislikedFoods: [],
        wishes: null,
      };
      repository.findById.mockResolvedValue(
        buildConversation({
          menuId: MENU_ID,
          menuRequest,
          summary: 'Rejected the salmon.',
          messages: [buildMessage()],
        }),
      );

      await service.create({ fromConversationId: CONVERSATION_ID });
      await service.create({ fromConversationId: CONVERSATION_ID, menuId: null });

      expect(repository.findById).toHaveBeenCalledWith(PROFILE_ID, CONVERSATION_ID);
      expect(repository.create).toHaveBeenNthCalledWith(1, PROFILE_ID, {
        title: 'New conversation',
        menuId: MENU_ID,
        menuRequest,
      });
      expect(repository.create).toHaveBeenNthCalledWith(2, PROFILE_ID, {
        title: 'New conversation',
        menuId: null,
        menuRequest,
      });
    });

    it('fails for an unknown conversation to start from', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.create({ fromConversationId: CONVERSATION_ID })).rejects.toBeInstanceOf(
        ConversationNotFoundException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('fails for an unknown menu', async () => {
      menuService.getById.mockRejectedValue(new MenuNotFoundException());

      await expect(service.create({ menuId: MENU_ID })).rejects.toBeInstanceOf(
        MenuNotFoundException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('changes only the given fields', async () => {
      await service.update(CONVERSATION_ID, { title: 'Renamed' });
      await service.update(CONVERSATION_ID, { menuId: null });

      expect(repository.update).toHaveBeenNthCalledWith(1, CONVERSATION_ID, { title: 'Renamed' });
      expect(repository.update).toHaveBeenNthCalledWith(2, CONVERSATION_ID, { menuId: null });
      expect(menuService.getById).not.toHaveBeenCalled();
    });

    it('checks a new menu', async () => {
      menuService.getById.mockRejectedValue(new MenuNotFoundException());

      await expect(service.update(CONVERSATION_ID, { menuId: MENU_ID })).rejects.toBeInstanceOf(
        MenuNotFoundException,
      );
    });
  });

  it('deletes a conversation of the profile only', async () => {
    await service.delete(CONVERSATION_ID);
    expect(repository.delete).toHaveBeenCalledWith(CONVERSATION_ID);

    repository.findById.mockResolvedValue(null);
    await expect(service.delete(CONVERSATION_ID)).rejects.toBeInstanceOf(
      ConversationNotFoundException,
    );
  });

  describe('addUserMessage', () => {
    it('saves the message, returns its id and titles a new conversation after its first line', async () => {
      await expect(service.addUserMessage(buildConversation(), 'Hi\nsecond line')).resolves.toBe(
        'msg-new',
      );

      expect(repository.addMessage).toHaveBeenCalledWith(CONVERSATION_ID, {
        role: MessageRole.User,
        content: 'Hi\nsecond line',
      });
      expect(repository.update).toHaveBeenCalledWith(CONVERSATION_ID, { title: 'Hi' });
    });

    it('cuts a long first message to a title', async () => {
      await service.addUserMessage(buildConversation(), 'x'.repeat(100));

      expect(repository.update).toHaveBeenCalledWith(CONVERSATION_ID, {
        title: `${'x'.repeat(59)}…`,
      });
    });

    it('keeps the title of a conversation with messages or a custom title', async () => {
      await service.addUserMessage(buildConversation({ messages: [buildMessage()] }), 'Hi');
      await service.addUserMessage(buildConversation({ title: 'Mine' }), 'Hi');

      expect(repository.addMessage).toHaveBeenCalledTimes(2);
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  it('saves an assistant message with the menu version it suggests', async () => {
    await expect(
      service.addAssistantMessage(CONVERSATION_ID, 'Hello', { menuVersionId: MENU_VERSION_ID }),
    ).resolves.toBe('msg-new');

    expect(repository.addMessage).toHaveBeenCalledWith(CONVERSATION_ID, {
      role: MessageRole.Assistant,
      content: 'Hello',
      menuVersionId: MENU_VERSION_ID,
      toolCalls: [],
    });
  });

  it('saves the tool calls the model made for a reply, in order', async () => {
    const toolCalls = [
      {
        toolCallId: 'call_1',
        name: 'search_recipes',
        input: { query: 'soup' },
        output: { recipes: [] },
        error: null,
        durationMs: 12,
      },
      {
        toolCallId: 'call_2',
        name: 'save_menu',
        input: {},
        output: { error: 'not_found', message: 'No menu' },
        error: ChatToolErrorCode.NotFound,
        durationMs: 3,
      },
    ];

    await service.addAssistantMessage(CONVERSATION_ID, 'Done', { toolCalls });

    expect(repository.addMessage).toHaveBeenCalledWith(CONVERSATION_ID, {
      role: MessageRole.Assistant,
      content: 'Done',
      menuVersionId: undefined,
      preferenceChange: undefined,
      toolCalls: [
        {
          toolName: 'search_recipes',
          input: { query: 'soup' },
          output: { recipes: [] },
          error: null,
          durationMs: 12,
        },
        {
          toolName: 'save_menu',
          input: {},
          output: { error: 'not_found', message: 'No menu' },
          error: ChatToolErrorCode.NotFound,
          durationMs: 3,
        },
      ],
    });
  });

  it('saves the preference change a reply proposes with it', async () => {
    const change = {
      action: PreferenceChangeAction.Add,
      preferenceType: PreferenceType.Allergy,
      value: 'peanut',
    };

    await service.addAssistantMessage(CONVERSATION_ID, 'Add it?', { preferenceChange: change });

    expect(repository.addMessage).toHaveBeenCalledWith(CONVERSATION_ID, {
      role: MessageRole.Assistant,
      content: 'Add it?',
      menuVersionId: undefined,
      preferenceChange: change,
      toolCalls: [],
    });
  });

  describe('history', () => {
    const summarized = buildConversation({
      summary: 'Rejected the salmon.',
      lastSummarizedMessageId: 'last-summarized',
    });

    it('returns the messages after the summary', async () => {
      const messages = [buildMessage()];
      repository.findMessagesAfter.mockResolvedValue(messages);

      await expect(service.getUnsummarizedMessages(summarized)).resolves.toBe(messages);
      expect(repository.findMessagesAfter).toHaveBeenCalledWith(CONVERSATION_ID, 'last-summarized');
    });

    it('gives the model the summary and the latest messages within the budget', async () => {
      const long = 'a'.repeat(MESSAGE_MAX_LENGTH);
      const messages = Array.from({ length: 60 }, (_, index) =>
        buildMessage({ id: `message-${index}`, content: long }),
      );
      repository.findMessagesAfter.mockResolvedValue(messages);

      const history = await service.getModelHistory(summarized);

      expect(history.summary).toBe('Rejected the salmon.');
      expect(history.messages.length).toBeLessThan(messages.length);
      expect(history.messages.at(-1)).toBe(messages.at(-1));
      expect(historyTokens(history.messages)).toBeLessThanOrEqual(MODEL_HISTORY_MAX_TOKENS);
    });

    it('saves the summary', async () => {
      await service.saveSummary(CONVERSATION_ID, 'Rejected the salmon.', 'message-id');

      expect(repository.updateSummary).toHaveBeenCalledWith(
        CONVERSATION_ID,
        'Rejected the salmon.',
        'message-id',
      );
    });
  });

  describe('menu request', () => {
    const menuRequest = {
      days: 3,
      mealTypes: [MealType.Dinner],
      caloriesKcal: null,
      diets: [],
      excludedIngredients: [],
      dislikedFoods: [],
      wishes: null,
    };

    it('reads the stored menu request back', () => {
      expect(service.getMenuRequest(buildConversation({ menuRequest }))).toEqual(menuRequest);
    });

    it('reads a request stored before wishes existed as one without wishes', () => {
      const { wishes: _wishes, ...older } = menuRequest;

      expect(service.getMenuRequest(buildConversation({ menuRequest: older }))).toEqual(
        menuRequest,
      );
    });

    it.each([
      ['nothing stored', null],
      ['a value that no longer matches the schema', { days: 'three' }],
    ])('returns null for %s', (_name, stored) => {
      expect(service.getMenuRequest(buildConversation({ menuRequest: stored }))).toBeNull();
    });

    it('saves the menu request', async () => {
      await service.saveMenuRequest(CONVERSATION_ID, menuRequest);

      expect(repository.updateMenuRequest).toHaveBeenCalledWith(CONVERSATION_ID, menuRequest);
    });
  });
});
