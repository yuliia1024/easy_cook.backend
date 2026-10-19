import { Injectable, Logger } from '@nestjs/common';
import { INTENT_INSTRUCTIONS, INTENT_MAX_OUTPUT_TOKENS, Intent } from '../../../common/constants';
import { IntentResult, IntentResultSchema } from '../../../common/contracts';
import { AssistantInvalidOutputException } from '../../../common/exceptions';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';

/**
 * Classifies a chat message by the model. Sees only the message itself: no profile, recipes or
 * history. Output that does not match the schema becomes `clarification`, which never starts menu
 * generation; an API failure is rethrown.
 */
@Injectable()
export class IntentService {
  private readonly logger = new Logger(IntentService.name);

  constructor(private readonly openAiService: OpenAiService) {}

  public async classify(message: string, abortSignal?: AbortSignal): Promise<IntentResult> {
    try {
      return await this.openAiService.generateStructured(
        [{ role: 'user', content: message }],
        IntentResultSchema,
        {
          instructions: INTENT_INSTRUCTIONS,
          maxOutputTokens: INTENT_MAX_OUTPUT_TOKENS,
          abortSignal,
        },
      );
    } catch (error) {
      if (error instanceof AssistantInvalidOutputException) {
        this.logger.warn('Invalid intent from the model; asking the user to clarify');
        return { intent: Intent.Clarification };
      }
      throw error;
    }
  }
}
