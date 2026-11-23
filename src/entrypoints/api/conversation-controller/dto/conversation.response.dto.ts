import {
  MealType,
  MessageRole,
  PreferenceChangeAction,
  PreferenceChangeStatus,
  PreferenceType,
} from '../../../../common/constants';
import {
  PreferenceChange,
  PreferenceChangeSchema,
  WishOffer,
  WishOfferSchema,
} from '../../../../common/contracts';
import { PreferenceChangeResult } from '../../../../common/types';
import {
  ConversationSummary,
  ConversationWithMessages,
  MessageWithMenu,
} from '../../../../modules/data-access/conversation/conversation.repository';

/** A change of the dietary preferences the assistant proposed. */
export class PreferenceChangeResponseDto {
  action: PreferenceChangeAction;
  preferenceType: PreferenceType;
  /** @example peanut */
  value: string;

  static from({ action, preferenceType, value }: PreferenceChange): PreferenceChangeResponseDto {
    return { action, preferenceType, value };
  }
}

/** The proposed change, applied now (`applied`) or found in effect already (`already_applied`). */
export class PreferenceChangeResultResponseDto {
  status: PreferenceChangeStatus;
  change: PreferenceChangeResponseDto;

  static from({ status, change }: PreferenceChangeResult): PreferenceChangeResultResponseDto {
    return { status, change: PreferenceChangeResponseDto.from(change) };
  }
}

export class WishOfferRecipeResponseDto {
  id: string;
  /** @example Salmon poke bowl */
  name: string;
  mealType: MealType;
}

/** The closest recipes the assistant offered when none fitted the wishes of the menu request. */
export class WishOfferResponseDto {
  /** @example sushi */
  wishes: string;
  recipes: WishOfferRecipeResponseDto[];

  static from({ wishes, recipes }: WishOffer): WishOfferResponseDto {
    return { wishes, recipes: recipes.map(({ id, name, mealType }) => ({ id, name, mealType })) };
  }
}

export class MessageResponseDto {
  id: string;
  role: MessageRole;
  content: string;
  /** The menu version the assistant suggested with this reply, and its menu. */
  menuVersionId: string | null;
  menuId: string | null;
  /**
   * The change of the dietary preferences the assistant proposed with this reply. It is applied
   * only once confirmed, by a yes in the chat or `POST /conversations/:id/preference-change/confirm`,
   * and only while this is the latest reply.
   */
  preferenceChange: PreferenceChangeResponseDto | null;
  /**
   * The similar recipes the assistant offered with this reply: answered by a message, or by one
   * with `wishOffer` (`accept` / `decline`) from the buttons, while this is the latest reply.
   */
  wishOffer: WishOfferResponseDto | null;
  createdAt: Date;

  static from(message: MessageWithMenu): MessageResponseDto {
    const change = PreferenceChangeSchema.safeParse(message.preferenceChange);
    const offer = WishOfferSchema.safeParse(message.wishOffer);
    return {
      id: message.id,
      role: message.role as MessageRole,
      content: message.content,
      menuVersionId: message.menuVersionId,
      menuId: message.menuVersion?.menuId ?? null,
      preferenceChange: change.success ? PreferenceChangeResponseDto.from(change.data) : null,
      wishOffer: offer.success ? WishOfferResponseDto.from(offer.data) : null,
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
