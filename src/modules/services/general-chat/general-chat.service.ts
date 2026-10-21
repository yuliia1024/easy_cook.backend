import { Injectable } from '@nestjs/common';
import {
  GENERAL_CHAT_HISTORY_LIMIT,
  GENERAL_CHAT_INSTRUCTIONS,
  GENERAL_CHAT_MAX_OUTPUT_TOKENS,
} from '../../../common/constants';
import { ProfileContext } from '../../../common/types';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { ConversationService } from '../conversation/conversation.service';
import { toModelMessages } from '../conversation/model-messages';
import { profileMessage } from '../profile-context/model-profile';

/** Small talk about meal planning, answered by the model from the recent history and the profile. */
@Injectable()
export class GeneralChatService {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly openAiService: OpenAiService,
  ) {}

  /** Streams the reply to the conversation; its latest message is the one to answer. */
  public async *reply(
    conversationId: string,
    profile: ProfileContext | null,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<string> {
    const messages = await this.conversationService.getRecentMessages(
      conversationId,
      GENERAL_CHAT_HISTORY_LIMIT,
    );
    yield* this.openAiService.streamText([profileMessage(profile), ...toModelMessages(messages)], {
      instructions: GENERAL_CHAT_INSTRUCTIONS,
      maxOutputTokens: GENERAL_CHAT_MAX_OUTPUT_TOKENS,
      abortSignal,
    });
  }
}
