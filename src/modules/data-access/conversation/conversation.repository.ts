import { Injectable } from '@nestjs/common';
import { Message, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../providers/prisma/prisma.service';
import { SortOrder } from '../../../common/constants';
import { MenuComposition } from '../../../common/types';
import { MenuRequest } from '../../../common/contracts';

/** Oldest first; the id only makes ties deterministic. */
const MESSAGE_ORDER = [
  { createdAt: SortOrder.Asc },
  { id: SortOrder.Asc },
] satisfies Prisma.MessageOrderByWithRelationInput[];

export const CONVERSATION_INCLUDE = {
  messages: {
    orderBy: MESSAGE_ORDER,
    include: { menuVersion: { select: { menuId: true } } },
  },
} satisfies Prisma.ConversationInclude;

export type ConversationWithMessages = Prisma.ConversationGetPayload<{
  include: typeof CONVERSATION_INCLUDE;
}>;
export type MessageWithMenu = ConversationWithMessages['messages'][number];
export type ConversationSummary = Prisma.ConversationGetPayload<{
  include: { _count: { select: { messages: true } } };
}>;

export interface ConversationData {
  title: string;
  menuId?: string | null;
}

export interface MessageData {
  role: string;
  content: string;
  menuVersionId?: string | null;
  suggestedMenu?: MenuComposition;
}

@Injectable()
export class ConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Most recently active first. */
  public async findAll(profileId: string): Promise<ConversationSummary[]> {
    return this.prisma.conversation.findMany({
      where: { profileId },
      include: { _count: { select: { messages: true } } },
      orderBy: [{ updatedAt: SortOrder.Desc }, { id: SortOrder.Asc }],
    });
  }

  public async findById(profileId: string, id: string): Promise<ConversationWithMessages | null> {
    return this.prisma.conversation.findFirst({
      where: { id, profileId },
      include: CONVERSATION_INCLUDE,
    });
  }

  /** The latest `limit` messages, oldest first. */
  public async findRecentMessages(conversationId: string, limit: number): Promise<Message[]> {
    const latest = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: SortOrder.Desc }, { id: SortOrder.Desc }],
      take: limit,
    });
    return latest.reverse();
  }

  public async create(
    profileId: string,
    data: ConversationData,
  ): Promise<ConversationWithMessages> {
    return this.prisma.conversation.create({
      data: { profileId, ...data },
      include: CONVERSATION_INCLUDE,
    });
  }

  public async update(
    id: string,
    data: Partial<ConversationData>,
  ): Promise<ConversationWithMessages> {
    return this.prisma.conversation.update({
      where: { id },
      data,
      include: CONVERSATION_INCLUDE,
    });
  }

  /** Does not mark the conversation as active: the message that changed it already did. */
  public async updateMenuRequest(id: string, menuRequest: MenuRequest): Promise<void> {
    await this.prisma.conversation.update({
      where: { id },
      data: { menuRequest: menuRequest as unknown as Prisma.InputJsonObject },
    });
  }

  /** Also marks the conversation as active, so it moves to the top of the list. */
  public async addMessage(conversationId: string, data: MessageData): Promise<Message> {
    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId,
          ...data,
          suggestedMenu: data.suggestedMenu as unknown as Prisma.InputJsonObject | undefined,
        },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);
    return message;
  }

  public async delete(id: string): Promise<void> {
    await this.prisma.conversation.delete({ where: { id } });
  }
}
