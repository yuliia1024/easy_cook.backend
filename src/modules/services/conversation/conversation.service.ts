import { Injectable } from '@nestjs/common';
import {
  AUTO_TITLE_LENGTH,
  DEFAULT_CONVERSATION_TITLE,
  MessageRole,
  MODEL_HISTORY_MAX_TOKENS,
} from '../../../common/constants';
import { ConversationNotFoundException } from '../../../common/exceptions';
import { MenuRequest, MenuRequestSchema, PreferenceChange } from '../../../common/contracts';
import {
  ConversationRepository,
  ConversationSummary,
  ConversationWithMessages,
  MessageWithMenu,
} from '../../data-access/conversation/conversation.repository';
import { Conversation } from '../../../generated/prisma/client';
import { MenuService } from '../menu/menu.service';
import { UserProfileService } from '../user-profile/user-profile.service';
import { ChatToolCall } from '../chat-tools/chat-tool-registry';
import { fitHistory } from './model-messages';

export interface ConversationInput {
  title?: string | null;
  menuId?: string | null;
}

export interface NewConversationInput extends ConversationInput {
  /** The conversation to carry the menu request and, unless `menuId` is given, the menu from. */
  fromConversationId?: string | null;
}

/** What an assistant reply carries besides its text. */
export interface AssistantMessageExtras {
  /** The draft version the reply suggests. */
  menuVersionId?: string;
  /** The change of the preferences it proposes, waiting for the user's yes. */
  preferenceChange?: PreferenceChange;
  /** The steps the chat model took for it, in order. */
  toolCalls?: ChatToolCall[];
}

/** The part of a conversation that tells which of its messages the summary covers. */
export type SummaryState = Pick<Conversation, 'id' | 'summary' | 'lastSummarizedMessageId'>;

/** What the model reads of a conversation: the summary of the older messages and the latest ones. */
export interface ModelHistory {
  summary: string | null;
  /** Oldest first, within `MODEL_HISTORY_MAX_TOKENS`. */
  messages: MessageWithMenu[];
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

  /**
   * A conversation started from another one (`fromConversationId`, such as one that is full) gets
   * its menu request and its menu, never its messages. 404 for a menu or a conversation of another
   * profile or an unknown one.
   */
  public async create(input: NewConversationInput): Promise<ConversationWithMessages> {
    const profile = await this.userProfileService.getCurrent();
    const source = input.fromConversationId ? await this.getById(input.fromConversationId) : null;
    const menuId = input.menuId !== undefined ? input.menuId : (source?.menuId ?? null);
    if (input.menuId) {
      await this.menuService.getById(input.menuId);
    }
    return this.conversationRepository.create(profile.id, {
      title: input.title ?? DEFAULT_CONVERSATION_TITLE,
      menuId,
      menuRequest: source && this.getMenuRequest(source),
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

  /** Saves the reply with what it suggested and the tool calls the model made for it. */
  public async addAssistantMessage(
    conversationId: string,
    content: string,
    { menuVersionId, preferenceChange, toolCalls = [] }: AssistantMessageExtras = {},
  ): Promise<void> {
    await this.conversationRepository.addMessage(conversationId, {
      role: MessageRole.Assistant,
      content,
      menuVersionId,
      preferenceChange,
      toolCalls: toolCalls.map(({ name, input, output, error, durationMs }) => ({
        toolName: name,
        input,
        output,
        error,
        durationMs,
      })),
    });
  }

  /**
   * The menu request the chat gathered so far; null before the first one. A stored value that no
   * longer matches the schema is dropped rather than failing every later message of the chat.
   */
  public getMenuRequest(conversation: Pick<Conversation, 'menuRequest'>): MenuRequest | null {
    const parsed = MenuRequestSchema.safeParse(conversation.menuRequest);
    return parsed.success ? parsed.data : null;
  }

  public async saveMenuRequest(conversationId: string, menuRequest: MenuRequest): Promise<void> {
    await this.conversationRepository.updateMenuRequest(conversationId, menuRequest);
  }

  /** The messages the summary does not cover yet, oldest first. */
  public async getUnsummarizedMessages(conversation: SummaryState): Promise<MessageWithMenu[]> {
    return this.conversationRepository.findMessagesAfter(
      conversation.id,
      conversation.lastSummarizedMessageId,
    );
  }

  /**
   * The summary and the latest messages after it that fit the history budget. Messages that do
   * not fit and are not summarized yet are left out (`ConversationSummaryService` folds them in).
   */
  public async getModelHistory(conversation: SummaryState): Promise<ModelHistory> {
    const messages = await this.getUnsummarizedMessages(conversation);
    return {
      summary: conversation.summary,
      messages: fitHistory(messages, MODEL_HISTORY_MAX_TOKENS),
    };
  }

  public async saveSummary(
    conversationId: string,
    summary: string,
    lastSummarizedMessageId: string,
  ): Promise<void> {
    await this.conversationRepository.updateSummary(
      conversationId,
      summary,
      lastSummarizedMessageId,
    );
  }

  private titleFrom(content: string): string {
    const line = content.trim().split('\n')[0];
    return line.length > AUTO_TITLE_LENGTH ? `${line.slice(0, AUTO_TITLE_LENGTH - 1)}…` : line;
  }
}
