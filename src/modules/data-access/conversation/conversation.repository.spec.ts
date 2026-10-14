import { MessageRole, SortOrder } from '../../../common/constants';
import { buildMessage, CONVERSATION_ID, MENU_ID, PROFILE_ID } from '../../../test/fixtures';
import { createPrismaMock, PrismaMock } from '../../../test/prisma-mock';
import { CONVERSATION_INCLUDE, ConversationRepository } from './conversation.repository';

describe('ConversationRepository', () => {
  let prisma: PrismaMock;
  let repository: ConversationRepository;

  beforeEach(() => {
    prisma = createPrismaMock();
    repository = new ConversationRepository(prisma);
  });

  it('orders messages oldest first, with the menu of their version', () => {
    expect(CONVERSATION_INCLUDE.messages).toEqual({
      orderBy: [{ createdAt: SortOrder.Asc }, { id: SortOrder.Asc }],
      include: { menuVersion: { select: { menuId: true } } },
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

  it('returns the latest messages oldest first', async () => {
    const newer = buildMessage({ id: 'b', content: 'newer' });
    const older = buildMessage({ id: 'a', content: 'older' });
    prisma.message.findMany.mockResolvedValue([newer, older]);

    await expect(repository.findRecentMessages(CONVERSATION_ID, 2)).resolves.toEqual([
      older,
      newer,
    ]);
    expect(prisma.message.findMany).toHaveBeenCalledWith({
      where: { conversationId: CONVERSATION_ID },
      orderBy: [{ createdAt: SortOrder.Desc }, { id: SortOrder.Desc }],
      take: 2,
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

  it('deletes a conversation', async () => {
    await repository.delete(CONVERSATION_ID);

    expect(prisma.conversation.delete).toHaveBeenCalledWith({ where: { id: CONVERSATION_ID } });
  });
});
