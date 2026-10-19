import { MealType, MessageRole } from '../../../../common/constants';
import { DayComposition, MealComposition, MenuComposition } from '../../../../common/types';
import {
  ConversationSummary,
  ConversationWithMessages,
  MessageWithMenu,
} from '../../../../modules/data-access/conversation/conversation.repository';
import { MenuIssueResponseDto } from '../../menu-controller/dto/menu.response.dto';
import { MacrosResponseDto } from '../../recipe-controller/dto/recipe.response.dto';

export class SuggestedMealResponseDto implements MealComposition {
  position: number;
  mealType: MealType;
  recipeId: string | null;
  recipeName: string;
  servings: number;
  /** Per serving times `servings`. */
  nutrition: MacrosResponseDto;
  complete: boolean;
}

export class SuggestedDayResponseDto implements DayComposition {
  dayIndex: number;
  /** `YYYY-MM-DD`. */
  date: string | null;
  meals: SuggestedMealResponseDto[];
  totals: MacrosResponseDto;
  complete: boolean;
}

export class SuggestedMenuResponseDto implements MenuComposition {
  days: SuggestedDayResponseDto[];
  dailyAverage: MacrosResponseDto;
  issues: MenuIssueResponseDto[];
}

export class MessageResponseDto {
  id: string;
  role: MessageRole;
  content: string;
  /** The menu version the assistant created with this reply, and its menu. */
  menuVersionId: string | null;
  menuId: string | null;
  /** The menu the assistant suggested with this reply; not a saved menu. */
  suggestedMenu: SuggestedMenuResponseDto | null;
  createdAt: Date;

  static from(message: MessageWithMenu): MessageResponseDto {
    return {
      id: message.id,
      role: message.role as MessageRole,
      content: message.content,
      menuVersionId: message.menuVersionId,
      menuId: message.menuVersion?.menuId ?? null,
      suggestedMenu: message.suggestedMenu as unknown as MenuComposition | null,
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
