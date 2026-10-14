import { MessageRole } from '../../../common/constants';
import {
  ConversationNotFoundException,
  MenuNotFoundException,
  NutritionGoalNotFoundException,
} from '../../../common/exceptions';
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
import { Assistant } from '../assistant/assistant';
import { MenuComposer, MenuContext } from '../menu/menu-composer';
import { MenuService } from '../menu/menu.service';
import { UserProfileService } from '../user-profile/user-profile.service';
import { ChatService } from './chat.service';

describe('ChatService', () => {
  let repository: jest.Mocked<ConversationRepository>;
  let menuService: jest.Mocked<MenuService>;
  let composer: jest.Mocked<MenuComposer>;
  let assistant: jest.Mocked<Assistant>;
  let service: ChatService;
  const conversation = buildConversation();
  const menu = buildMenu({ versions: [buildMenuVersion()] });
  const context: MenuContext = {
    profileId: PROFILE_ID,
    goal: null,
    rules: { diets: ['vegan'], allergies: [], excludedIngredients: [], dislikedFoods: [] },
  };

  beforeEach(() => {
    repository = createMock<ConversationRepository>();
    repository.findById.mockResolvedValue(conversation);
    const profileService = createMock<UserProfileService>();
    profileService.getCurrent.mockResolvedValue(buildProfile());
    menuService = createMock<MenuService>();
    menuService.getById.mockResolvedValue(menu);
    composer = createMock<MenuComposer>();
    composer.context.mockResolvedValue(context);
    assistant = createMock<Assistant>();
    service = new ChatService(repository, profileService, menuService, composer, assistant);
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
      });
      expect(menuService.getById).not.toHaveBeenCalled();
    });

    it('checks the menu belongs to the profile', async () => {
      await service.create({ title: 'About week 1', menuId: MENU_ID });

      expect(menuService.getById).toHaveBeenCalledWith(MENU_ID);
      expect(repository.create).toHaveBeenCalledWith(PROFILE_ID, {
        title: 'About week 1',
        menuId: MENU_ID,
      });
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

  describe('sendMessage', () => {
    const history = [
      buildMessage({ content: 'Hi' }),
      buildMessage({ role: MessageRole.Assistant, content: 'Hello' }),
    ];

    beforeEach(() => {
      repository.findRecentMessages.mockResolvedValue(history);
    });

    it('saves the message, titles the conversation and saves the reply', async () => {
      assistant.reply.mockResolvedValue({ content: 'A reply', action: null });

      await service.sendMessage(CONVERSATION_ID, 'Hi\nsecond line');

      expect(repository.addMessage).toHaveBeenNthCalledWith(1, CONVERSATION_ID, {
        role: MessageRole.User,
        content: 'Hi\nsecond line',
      });
      expect(repository.update).toHaveBeenCalledWith(CONVERSATION_ID, { title: 'Hi' });
      expect(repository.findRecentMessages).toHaveBeenCalledWith(CONVERSATION_ID, 20);
      expect(assistant.reply).toHaveBeenCalledWith({
        messages: [
          { role: MessageRole.User, content: 'Hi' },
          { role: MessageRole.Assistant, content: 'Hello' },
        ],
        goal: null,
        rules: context.rules,
        menu: null,
      });
      expect(repository.addMessage).toHaveBeenNthCalledWith(2, CONVERSATION_ID, {
        role: MessageRole.Assistant,
        content: 'A reply',
        menuVersionId: null,
      });
      expect(menuService.generate).not.toHaveBeenCalled();
    });

    it('cuts a long first message to a title', async () => {
      assistant.reply.mockResolvedValue({ content: 'ok', action: null });

      await service.sendMessage(CONVERSATION_ID, 'x'.repeat(100));

      expect(repository.update).toHaveBeenCalledWith(CONVERSATION_ID, {
        title: `${'x'.repeat(59)}…`,
      });
    });

    it('keeps the title of a conversation with messages or a custom title', async () => {
      repository.findById.mockResolvedValue(buildConversation({ messages: history }));
      assistant.reply.mockResolvedValue({ content: 'ok', action: null });
      await service.sendMessage(CONVERSATION_ID, 'Hi');

      repository.findById.mockResolvedValue(buildConversation({ title: 'Mine' }));
      await service.sendMessage(CONVERSATION_ID, 'Hi');

      expect(repository.update).not.toHaveBeenCalled();
    });

    it('tells the assistant which menu the conversation is about', async () => {
      repository.findById.mockResolvedValue(buildConversation({ title: 'Mine', menuId: MENU_ID }));
      assistant.reply.mockResolvedValue({ content: 'ok', action: null });

      await service.sendMessage(CONVERSATION_ID, 'Hi');

      expect(assistant.reply).toHaveBeenCalledWith(
        expect.objectContaining({ menu: { id: MENU_ID, title: 'Week 1' } }),
      );
    });

    it('plans a menu when asked to, links it and describes it', async () => {
      assistant.reply.mockResolvedValue({
        content: 'Planning a 3-day menu.',
        action: { type: 'plan_menu', days: 3, mealTypes: null, instructions: 'plan 3 days' },
      });
      menuService.generate.mockResolvedValue(menu);

      await service.sendMessage(CONVERSATION_ID, 'plan 3 days');

      expect(menuService.generate).toHaveBeenCalledWith({
        title: null,
        days: 3,
        mealTypes: null,
        startDate: null,
        instructions: 'plan 3 days',
      });
      expect(repository.addMessage).toHaveBeenNthCalledWith(2, CONVERSATION_ID, {
        role: MessageRole.Assistant,
        content:
          'Planning a 3-day menu.\n\n"Week 1" is ready as a draft: 1 day, about 130 kcal a day. ' +
          'Open it to review and confirm.',
        menuVersionId: MENU_VERSION_ID,
      });
      expect(repository.update).toHaveBeenCalledWith(CONVERSATION_ID, { menuId: MENU_ID });
    });

    it('counts the warnings of the planned menu', async () => {
      const version = buildMenuVersion();
      (version.compositionSnapshot as { issues: unknown[] }).issues = [{}, {}];
      menuService.generate.mockResolvedValue(buildMenu({ versions: [version] }));
      assistant.reply.mockResolvedValue({
        content: 'Planning.',
        action: { type: 'plan_menu', days: 1, mealTypes: null, instructions: null },
      });

      await service.sendMessage(CONVERSATION_ID, 'plan');

      expect(repository.addMessage.mock.calls[1][1].content).toContain(
        '130 kcal a day, 2 warnings.',
      );
    });

    it('turns a rejected action into the reply', async () => {
      assistant.reply.mockResolvedValue({
        content: 'Planning a 7-day menu.',
        action: { type: 'plan_menu', days: 7, mealTypes: null, instructions: null },
      });
      menuService.generate.mockRejectedValue(new NutritionGoalNotFoundException());

      await service.sendMessage(CONVERSATION_ID, 'plan');

      expect(repository.addMessage).toHaveBeenNthCalledWith(2, CONVERSATION_ID, {
        role: MessageRole.Assistant,
        content:
          'Planning a 7-day menu.\n\nI could not plan the menu: No nutrition goal is set yet',
        menuVersionId: null,
      });
    });

    it('does not swallow unexpected errors', async () => {
      assistant.reply.mockResolvedValue({
        content: 'Planning.',
        action: { type: 'plan_menu', days: 1, mealTypes: null, instructions: null },
      });
      menuService.generate.mockRejectedValue(new Error('database down'));

      await expect(service.sendMessage(CONVERSATION_ID, 'plan')).rejects.toThrow('database down');
    });

    it('fails for an unknown conversation before saving anything', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.sendMessage(CONVERSATION_ID, 'Hi')).rejects.toBeInstanceOf(
        ConversationNotFoundException,
      );
      expect(repository.addMessage).not.toHaveBeenCalled();
    });
  });
});
