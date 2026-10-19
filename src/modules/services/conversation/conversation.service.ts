import { Injectable } from '@nestjs/common';
import {
  AUTO_TITLE_LENGTH,
  DEFAULT_CONVERSATION_TITLE,
  MessageRole,
} from '../../../common/constants';
import { ConversationNotFoundException } from '../../../common/exceptions';
import {
  ConversationRepository,
  ConversationSummary,
  ConversationWithMessages,
} from '../../data-access/conversation/conversation.repository';
import { Message } from '../../../generated/prisma/client';
import { MenuService } from '../menu/menu.service';
import { UserProfileService } from '../user-profile/user-profile.service';

export interface ConversationInput {
  title?: string | null;
  menuId?: string | null;
}

/**
 * Conversations of the profile: listed, read, created, renamed, linked to a menu and deleted, and
 * their messages: saved as they are sent and read back for the model.
 */
@Injectable()
export class ConversationService {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly userProfileService: UserProfileService,
    private readonly menuService: MenuService,
  ) {}

  public async getAll(): Promise<ConversationSummary[]> {
    const profile = await this.userProfileService.getCurrent();
    return this.conversationRepository.findAll(profile.id);
  }

  public async getById(id: string): Promise<ConversationWithMessages> {
    const profile = await this.userProfileService.getCurrent();
    const conversation = await this.conversationRepository.findById(profile.id, id);
    if (!conversation) {
      throw new ConversationNotFoundException();
    }
    return conversation;
  }

  /** 404 for a menu of another profile or an unknown one. */
  public async create(input: ConversationInput): Promise<ConversationWithMessages> {
    const profile = await this.userProfileService.getCurrent();
    if (input.menuId) {
      await this.menuService.getById(input.menuId);
    }
    return this.conversationRepository.create(profile.id, {
      title: input.title ?? DEFAULT_CONVERSATION_TITLE,
      menuId: input.menuId ?? null,
    });
  }

  public async update(id: string, input: ConversationInput): Promise<ConversationWithMessages> {
    await this.getById(id);
    if (input.menuId) {
      await this.menuService.getById(input.menuId);
    }
    return this.conversationRepository.update(id, {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.menuId !== undefined && { menuId: input.menuId }),
    });
  }

  public async delete(id: string): Promise<void> {
    await this.getById(id);
    await this.conversationRepository.delete(id);
  }

  /** The first message of an untitled conversation also becomes its title. */
  public async addUserMessage(
    conversation: ConversationWithMessages,
    content: string,
  ): Promise<void> {
    await this.conversationRepository.addMessage(conversation.id, {
      role: MessageRole.User,
      content,
    });
    if (conversation.messages.length === 0 && conversation.title === DEFAULT_CONVERSATION_TITLE) {
      await this.conversationRepository.update(conversation.id, { title: this.titleFrom(content) });
    }
  }

  public async addAssistantMessage(conversationId: string, content: string): Promise<void> {
    await this.conversationRepository.addMessage(conversationId, {
      role: MessageRole.Assistant,
      content,
    });
  }

  /** The latest `limit` messages, oldest first. */
  public async getRecentMessages(conversationId: string, limit: number): Promise<Message[]> {
    return this.conversationRepository.findRecentMessages(conversationId, limit);
  }

  private titleFrom(content: string): string {
    const line = content.trim().split('\n')[0];
    return line.length > AUTO_TITLE_LENGTH ? `${line.slice(0, AUTO_TITLE_LENGTH - 1)}…` : line;
  }
}
