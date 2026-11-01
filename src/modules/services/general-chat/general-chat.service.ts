import { Injectable } from '@nestjs/common';
import {
  GENERAL_CHAT_INSTRUCTIONS,
  GENERAL_CHAT_MAX_OUTPUT_TOKENS,
} from '../../../common/constants';
import { MenuRequest } from '../../../common/contracts';
import { ProfileContext } from '../../../common/types';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { ModelHistory } from '../conversation/conversation.service';
import { toModelMessages } from '../conversation/model-messages';
import { profileMessage } from '../profile-context/model-profile';

/**
 * Small talk about meal planning, answered by the model from the recent history, the summary of
 * the older one, the menu request gathered so far and the profile.
 */
@Injectable()
export class GeneralChatService {
  constructor(private readonly openAiService: OpenAiService) {}

  /** Streams the reply to the conversation; the latest message of `history` is the one to answer. */
  public async *reply(
    history: ModelHistory,
    menuRequest: MenuRequest | null,
    profile: ProfileContext | null,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<string> {
    const context = { menuRequest, summary: history.summary };
    yield* this.openAiService.streamText(
      [profileMessage(profile, context), ...toModelMessages(history.messages)],
      {
        instructions: GENERAL_CHAT_INSTRUCTIONS,
        maxOutputTokens: GENERAL_CHAT_MAX_OUTPUT_TOKENS,
        abortSignal,
      },
    );
  }
}
