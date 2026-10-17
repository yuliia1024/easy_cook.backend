import { Injectable } from '@nestjs/common';
import { ModelMessage } from 'ai';
import {
  ASSISTANT_HISTORY_LIMIT,
  AUTO_TITLE_LENGTH,
  DEFAULT_CONVERSATION_TITLE,
  MessageRole,
} from '../../../common/constants';
import { ConversationNotFoundException } from '../../../common/exceptions';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';
import {
  ConversationRepository,
  ConversationSummary,
  ConversationWithMessages,
} from '../../data-access/conversation/conversation.repository';
import { MenuService } from '../menu/menu.service';
import { UserProfileService } from '../user-profile/user-profile.service';

export interface ConversationInput {
  title?: string | null;
  menuId?: string | null;
}

/**
 * Conversations with the assistant. A user message is saved first, then the model answers from
 * the recent history as a text stream; the answer is saved once it is complete.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly userProfileService: UserProfileService,
    private readonly menuService: MenuService,
    private readonly openAiService: OpenAiService,
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

  /**
   * Saves the message and returns the stream of the reply. 404 for an unknown conversation comes
   * before the stream; the reply is saved when the stream completes, not when it fails.
   */
  public async sendMessage(id: string, content: string): Promise<AsyncGenerator<string>> {
    const conversation = await this.getById(id);

    await this.conversationRepository.addMessage(id, { role: MessageRole.User, content });
    if (conversation.messages.length === 0 && conversation.title === DEFAULT_CONVERSATION_TITLE) {
      await this.conversationRepository.update(id, { title: this.titleFrom(content) });
    }

    const history = await this.conversationRepository.findRecentMessages(
      id,
      ASSISTANT_HISTORY_LIMIT,
    );

    const contextWithNewMessage = history.map((message): ModelMessage => ({
      role: message.role === MessageRole.Assistant ? 'assistant' : 'user',
      content: message.content,
    }));

    return this.streamReply(id, contextWithNewMessage);
  }

  private async *streamReply(id: string, history: ModelMessage[]): AsyncGenerator<string> {
    let reply = '';
    for await (const delta of this.openAiService.streamText(history)) {
      reply += delta;
      yield delta;
    }
    await this.conversationRepository.addMessage(id, {
      role: MessageRole.Assistant,
      content: reply,
    });
  }

  private titleFrom(content: string): string {
    const line = content.trim().split('\n')[0];
    return line.length > AUTO_TITLE_LENGTH ? `${line.slice(0, AUTO_TITLE_LENGTH - 1)}…` : line;
  }
}
