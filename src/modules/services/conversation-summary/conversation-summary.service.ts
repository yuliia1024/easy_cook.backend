import { Injectable } from '@nestjs/common';
import {
  MODEL_HISTORY_MAX_TOKENS,
  SUMMARY_INSTRUCTIONS,
  SUMMARY_KEEP_MESSAGES,
  SUMMARY_MAX_OUTPUT_TOKENS,
  SUMMARY_TRIGGER_RATIO,
} from '../../../common/constants';
import { SummaryResultSchema } from '../../../common/contracts';
import { Message } from '../../../generated/prisma/client';
import { ModelInput, OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { ConversationService, SummaryState } from '../conversation/conversation.service';
import { historyTokens } from '../conversation/model-messages';

/** The summary call: the earlier summary and the messages to fold into it, as JSON. */
export function summaryModelInput(
  earlierSummary: string | null,
  messages: Pick<Message, 'role' | 'content'>[],
): ModelInput {
  return [
    {
      role: 'user',
      content: JSON.stringify({
        earlierSummary,
        messages: messages.map(({ role, content }) => ({ role, content })),
      }),
    },
  ];
}

/**
 * The rolling summary of a conversation. Once the messages after the summary take
 * `SUMMARY_TRIGGER_RATIO` of the history budget, all of them but the latest
 * `SUMMARY_KEEP_MESSAGES` are folded into it by the model, so the summary grows by increments and
 * never reads the whole chat again. It keeps only free text: the menu details stay in the menu
 * request (`conversations.menu_request`), which never depends on it.
 */
@Injectable()
export class ConversationSummaryService {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly openAiService: OpenAiService,
  ) {}

  /** Returns whether it summarized; a failed model call is rethrown and nothing is saved. */
  public async summarizeIfNeeded(
    conversation: SummaryState,
    abortSignal?: AbortSignal,
  ): Promise<boolean> {
    const messages = await this.conversationService.getUnsummarizedMessages(conversation);
    if (historyTokens(messages) <= MODEL_HISTORY_MAX_TOKENS * SUMMARY_TRIGGER_RATIO) {
      return false;
    }
    const older = messages.slice(0, -SUMMARY_KEEP_MESSAGES);
    const last = older.at(-1);
    if (!last) {
      return false;
    }
    const { summary } = await this.openAiService.generateStructured(
      summaryModelInput(conversation.summary, older),
      SummaryResultSchema,
      {
        instructions: SUMMARY_INSTRUCTIONS,
        maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
        abortSignal,
      },
    );
    await this.conversationService.saveSummary(conversation.id, summary, last.id);
    return true;
  }
}
