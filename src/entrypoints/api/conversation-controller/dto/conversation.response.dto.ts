import { MessageRole } from '../../../../common/constants';
import {
  ConversationSummary,
  ConversationWithMessages,
  MessageWithMenu,
} from '../../../../modules/data-access/conversation/conversation.repository';

export class MessageResponseDto {
  id: string;
  role: MessageRole;
  content: string;
  /** The menu version the assistant created with this reply, and its menu. */
  menuVersionId: string | null;
  menuId: string | null;
  createdAt: Date;

  static from(message: MessageWithMenu): MessageResponseDto {
    return {
      id: message.id,
      role: message.role as MessageRole,
      content: message.content,
      menuVersionId: message.menuVersionId,
      menuId: message.menuVersion?.menuId ?? null,
      createdAt: message.createdAt,
    };
  }
}

export class ConversationSummaryResponseDto {
  id: string;
  title: string;
  menuId: string | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;

  static from(conversation: ConversationSummary): ConversationSummaryResponseDto {
    return {
      id: conversation.id,
      title: conversation.title,
      menuId: conversation.menuId,
      messageCount: conversation._count.messages,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }
}

export class ConversationResponseDto {
  id: string;
  title: string;
  /** The menu the conversation is about: the last one the assistant planned or the user picked. */
  menuId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Oldest first. */
  messages: MessageResponseDto[];

  static from(conversation: ConversationWithMessages): ConversationResponseDto {
    return {
      id: conversation.id,
      title: conversation.title,
      menuId: conversation.menuId,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages.map(MessageResponseDto.from),
    };
  }
}
