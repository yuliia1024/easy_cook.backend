import { Injectable } from '@nestjs/common';
import {
  INTENT_HISTORY_LIMIT,
  INTENT_INSTRUCTIONS,
  INTENT_MAX_OUTPUT_TOKENS,
} from '../../../common/constants';
import { IntentResult, IntentResultSchema } from '../../../common/contracts';
import { ProfileContext } from '../../../common/types';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { ConversationService } from '../conversation/conversation.service';
import { toModelMessages } from '../conversation/model-messages';
import { profileMessage } from '../profile-context/model-profile';

/**
 * Classifies the latest message of a conversation by the model, which reads the recent history
 * to understand follow-ups and the profile to tell whether a request is enough, and restates a menu
 * request on its own. No recipes. Output
 * that does not match the schema (`AssistantInvalidOutputException`) and API failures are
 * rethrown; the chat answers both with a neutral error, never with a guessed intent.
 */
@Injectable()
export class IntentService {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly openAiService: OpenAiService,
  ) {}

  public async classify(
    conversationId: string,
    profile: ProfileContext | null,
    abortSignal?: AbortSignal,
  ): Promise<IntentResult> {
    const messages = await this.conversationService.getRecentMessages(
      conversationId,
      INTENT_HISTORY_LIMIT,
    );
    return this.openAiService.generateStructured(
      [profileMessage(profile), ...toModelMessages(messages)],
      IntentResultSchema,
      {
        instructions: INTENT_INSTRUCTIONS,
        maxOutputTokens: INTENT_MAX_OUTPUT_TOKENS,
        abortSignal,
      },
    );
  }
}
