import { MealType, MessageRole } from '../../../common/constants';
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
  PROFILE_ID,
} from '../../../test/fixtures';
import { ConversationRepository } from '../../data-access/conversation/conversation.repository';
import { MenuService } from '../menu/menu.service';
import { UserProfileService } from '../user-profile/user-profile.service';
import { ConversationService } from './conversation.service';

describe('ConversationService', () => {
  let repository: jest.Mocked<ConversationRepository>;
  let menuService: jest.Mocked<MenuService>;
  let service: ConversationService;
  const conversation = buildConversation();
  const menu = buildMenu({ versions: [buildMenuVersion()] });

  beforeEach(() => {
    repository = createMock<ConversationRepository>();
    repository.findById.mockResolvedValue(conversation);
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

  describe('addUserMessage', () => {
    it('saves the message and titles a new conversation after its first line', async () => {
      await service.addUserMessage(buildConversation(), 'Hi\nsecond line');

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

  it('saves an assistant message with the menu it suggests', async () => {
    const menu = {
      days: [],
      dailyAverage: { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
      issues: [],
    };

    await service.addAssistantMessage(CONVERSATION_ID, 'Hello', menu);

    expect(repository.addMessage).toHaveBeenCalledWith(CONVERSATION_ID, {
      role: MessageRole.Assistant,
      content: 'Hello',
      suggestedMenu: menu,
    });
  });

  it('returns the latest messages', async () => {
    const messages = [buildMessage()];
    repository.findRecentMessages.mockResolvedValue(messages);

    await expect(service.getRecentMessages(CONVERSATION_ID, 10)).resolves.toBe(messages);
    expect(repository.findRecentMessages).toHaveBeenCalledWith(CONVERSATION_ID, 10);
  });

  describe('menu request', () => {
    const menuRequest = {
      days: 3,
      mealTypes: [MealType.Dinner],
      caloriesKcal: null,
      diets: [],
      excludedIngredients: [],
      dislikedFoods: [],
    };

    it('reads the stored menu request back', () => {
      expect(service.getMenuRequest(buildConversation({ menuRequest }))).toEqual(menuRequest);
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
