import { Injectable } from '@nestjs/common';
import { INTENT_INSTRUCTIONS, INTENT_MAX_OUTPUT_TOKENS } from '../../../common/constants';
import { IntentResult, IntentResultSchema } from '../../../common/contracts';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';

/**
 * Classifies a chat message by the model. Sees only the message itself: no profile, recipes or
 * history. Output that does not match the schema (`AssistantInvalidOutputException`) and API
 * failures are rethrown; the chat answers both with a neutral error, never with a guessed intent.
 */
@Injectable()
export class IntentService {
  constructor(private readonly openAiService: OpenAiService) {}

  public async classify(message: string, abortSignal?: AbortSignal): Promise<IntentResult> {
    return this.openAiService.generateStructured(
      [{ role: 'user', content: message }],
      IntentResultSchema,
      {
        instructions: INTENT_INSTRUCTIONS,
        maxOutputTokens: INTENT_MAX_OUTPUT_TOKENS,
        abortSignal,
      },
    );
  }
}
