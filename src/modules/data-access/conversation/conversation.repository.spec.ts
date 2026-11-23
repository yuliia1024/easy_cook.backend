import { MessageRole, SortOrder } from '../../../common/constants';
import {
  buildMessage,
  CONVERSATION_ID,
  MENU_ID,
  MENU_VERSION_ID,
  PROFILE_ID,
} from '../../../test/fixtures';
import { createPrismaMock, PrismaMock } from '../../../test/prisma-mock';
import {
  CONVERSATION_INCLUDE,
  ConversationRepository,
  MESSAGE_INCLUDE,
} from './conversation.repository';

describe('ConversationRepository', () => {
  let prisma: PrismaMock;
  let repository: ConversationRepository;

  beforeEach(() => {
    prisma = createPrismaMock();
    repository = new ConversationRepository(prisma);
  });

  it('orders messages oldest first, with the menu and the composition of their version', () => {
    expect(CONVERSATION_INCLUDE.messages).toEqual({
      orderBy: [{ createdAt: SortOrder.Asc }, { id: SortOrder.Asc }],
      include: { menuVersion: { select: { menuId: true, compositionSnapshot: true } } },
    });
  });

  it('lists the profile conversations, most recently active first, with message counts', async () => {
    await repository.findAll(PROFILE_ID);

    expect(prisma.conversation.findMany).toHaveBeenCalledWith({
      where: { profileId: PROFILE_ID },
      include: { _count: { select: { messages: true } } },
      orderBy: [{ updatedAt: SortOrder.Desc }, { id: SortOrder.Asc }],
    });
  });

  it('loads a conversation of the profile with its messages', async () => {
    await repository.findById(PROFILE_ID, CONVERSATION_ID);

    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID, profileId: PROFILE_ID },
      include: CONVERSATION_INCLUDE,
    });
  });

  it('returns every message oldest first, or only those after the given one', async () => {
    const messages = [buildMessage()];
    prisma.message.findMany.mockResolvedValue(messages);
    const orderBy = [{ createdAt: SortOrder.Asc }, { id: SortOrder.Asc }];

    await expect(repository.findMessagesAfter(CONVERSATION_ID, null)).resolves.toBe(messages);
    await repository.findMessagesAfter(CONVERSATION_ID, 'last-summarized');

    expect(prisma.message.findMany).toHaveBeenNthCalledWith(1, {
      where: { conversationId: CONVERSATION_ID },
      include: MESSAGE_INCLUDE,
      orderBy,
    });
    expect(prisma.message.findMany).toHaveBeenNthCalledWith(2, {
      where: { conversationId: CONVERSATION_ID },
      include: MESSAGE_INCLUDE,
      orderBy,
      cursor: { id: 'last-summarized' },
      skip: 1,
    });
  });

  it('creates and updates a conversation', async () => {
    await repository.create(PROFILE_ID, { title: 'Chat', menuId: MENU_ID });
    await repository.update(CONVERSATION_ID, { menuId: null });

    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: { profileId: PROFILE_ID, title: 'Chat', menuId: MENU_ID },
      include: CONVERSATION_INCLUDE,
    });
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID },
      data: { menuId: null },
      include: CONVERSATION_INCLUDE,
    });
  });

  it('creates a conversation with the menu request of another one', async () => {
    const menuRequest = {
      days: 3,
      mealTypes: [],
      caloriesKcal: null,
      diets: [],
      excludedIngredients: ['mushrooms'],
      dislikedFoods: [],
      wishes: null,
    };
    await repository.create(PROFILE_ID, { title: 'Chat', menuRequest });

    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: { profileId: PROFILE_ID, title: 'Chat', menuRequest },
      include: CONVERSATION_INCLUDE,
    });
  });

  it('saves the summary with the last message it covers', async () => {
    await repository.updateSummary(CONVERSATION_ID, 'Rejected the salmon.', 'message-id');

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID },
      data: { summary: 'Rejected the salmon.', lastSummarizedMessageId: 'message-id' },
    });
  });

  it('adds a message and touches the conversation in one transaction', async () => {
    const message = buildMessage();
    prisma.message.create.mockReturnValue(message as never);
    prisma.conversation.update.mockReturnValue({} as never);

    await expect(
      repository.addMessage(CONVERSATION_ID, { role: MessageRole.User, content: 'Hi' }),
    ).resolves.toBe(message);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: { conversationId: CONVERSATION_ID, role: MessageRole.User, content: 'Hi' },
    });
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it('saves the menu version a message suggested', async () => {
    await repository.addMessage(CONVERSATION_ID, {
      role: MessageRole.Assistant,
      content: 'Your day',
      menuVersionId: MENU_VERSION_ID,
    });

    expect(prisma.message.create).toHaveBeenCalledWith({
      data: {
        conversationId: CONVERSATION_ID,
        role: MessageRole.Assistant,
        content: 'Your day',
        menuVersionId: MENU_VERSION_ID,
      },
    });
  });

  it('saves the tool calls of a reply with it, numbered in order', async () => {
    await repository.addMessage(CONVERSATION_ID, {
      role: MessageRole.Assistant,
      content: 'Done',
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
          input: undefined,
          output: { error: 'not_found' },
          error: 'not_found',
          durationMs: 3,
        },
      ],
    });

    expect(prisma.message.create).toHaveBeenCalledWith({
      data: {
        conversationId: CONVERSATION_ID,
        role: MessageRole.Assistant,
        content: 'Done',
        toolCalls: {
          create: [
            {
              position: 0,
              toolName: 'search_recipes',
              input: { query: 'soup' },
              output: { recipes: [] },
              error: null,
              durationMs: 12,
            },
            {
              position: 1,
              toolName: 'save_menu',
              input: {},
              output: { error: 'not_found' },
              error: 'not_found',
              durationMs: 3,
            },
          ],
        },
      },
    });
  });

  it('stores the menu request of a conversation as JSON', async () => {
    const menuRequest = {
      days: 3,
      mealTypes: [],
      caloriesKcal: null,
      diets: [],
      excludedIngredients: ['mushrooms'],
      dislikedFoods: [],
      wishes: null,
    };

    await repository.updateMenuRequest(CONVERSATION_ID, menuRequest);

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID },
      data: { menuRequest },
    });
  });

  it('deletes a conversation', async () => {
    await repository.delete(CONVERSATION_ID);

    expect(prisma.conversation.delete).toHaveBeenCalledWith({ where: { id: CONVERSATION_ID } });
  });
});
