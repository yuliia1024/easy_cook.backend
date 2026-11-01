import {
  MESSAGE_MAX_LENGTH,
  MessageRole,
  MODEL_HISTORY_MAX_TOKENS,
  SUMMARY_INSTRUCTIONS,
  SUMMARY_KEEP_MESSAGES,
  SUMMARY_MAX_OUTPUT_TOKENS,
  SUMMARY_TRIGGER_RATIO,
} from '../../../common/constants';
import { SummaryResultSchema } from '../../../common/contracts';
import { AssistantUnavailableException } from '../../../common/exceptions';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { createMock } from '../../../test/create-mock';
import { buildConversation, buildMessage, CONVERSATION_ID } from '../../../test/fixtures';
import { ConversationService } from '../conversation/conversation.service';
import { historyTokens } from '../conversation/model-messages';
import { ConversationSummaryService, summaryModelInput } from './conversation-summary.service';

describe('ConversationSummaryService', () => {
  let conversationService: jest.Mocked<ConversationService>;
  let openAiService: jest.Mocked<OpenAiService>;
  let service: ConversationSummaryService;
  const conversation = buildConversation({
    summary: 'Rejected the salmon.',
    lastSummarizedMessageId: 'last-summarized',
  });
  const messages = (count: number): ReturnType<typeof buildMessage>[] =>
    Array.from({ length: count }, (_, index) =>
      buildMessage({
        id: `message-${index}`,
        role: index % 2 === 0 ? MessageRole.User : MessageRole.Assistant,
        content: `${index} ${'a'.repeat(MESSAGE_MAX_LENGTH)}`,
      }),
    );
  const overThreshold = (): ReturnType<typeof buildMessage>[] => {
    let count = SUMMARY_KEEP_MESSAGES;
    while (historyTokens(messages(count)) <= MODEL_HISTORY_MAX_TOKENS * SUMMARY_TRIGGER_RATIO) {
      count += 1;
    }
    return messages(count);
  };

  beforeEach(() => {
    conversationService = createMock<ConversationService>();
    openAiService = createMock<OpenAiService>();
    openAiService.generateStructured.mockResolvedValue({ summary: 'New summary.' });
    service = new ConversationSummaryService(conversationService, openAiService);
  });

  it('does nothing while the messages after the summary are within the threshold', async () => {
    conversationService.getUnsummarizedMessages.mockResolvedValue(messages(4));

    await expect(service.summarizeIfNeeded(conversation)).resolves.toBe(false);
    expect(conversationService.getUnsummarizedMessages).toHaveBeenCalledWith(conversation);
    expect(openAiService.generateStructured).not.toHaveBeenCalled();
    expect(conversationService.saveSummary).not.toHaveBeenCalled();
  });

  it('folds all but the latest messages into the earlier summary and saves where it ends', async () => {
    const unsummarized = overThreshold();
    conversationService.getUnsummarizedMessages.mockResolvedValue(unsummarized);
    const older = unsummarized.slice(0, -SUMMARY_KEEP_MESSAGES);
    const abort = new AbortController();

    await expect(service.summarizeIfNeeded(conversation, abort.signal)).resolves.toBe(true);
    expect(openAiService.generateStructured).toHaveBeenCalledWith(
      summaryModelInput('Rejected the salmon.', older),
      SummaryResultSchema,
      {
        instructions: SUMMARY_INSTRUCTIONS,
        maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
        abortSignal: abort.signal,
      },
    );
    expect(conversationService.saveSummary).toHaveBeenCalledWith(
      CONVERSATION_ID,
      'New summary.',
      older.at(-1)?.id,
    );
  });

  it('does not summarize when only the messages it keeps are over the threshold', async () => {
    const long = buildMessage({ content: 'a'.repeat(10 * MODEL_HISTORY_MAX_TOKENS) });
    conversationService.getUnsummarizedMessages.mockResolvedValue([long]);

    await expect(service.summarizeIfNeeded(conversation)).resolves.toBe(false);
    expect(openAiService.generateStructured).not.toHaveBeenCalled();
  });

  it('saves nothing when the model call fails', async () => {
    conversationService.getUnsummarizedMessages.mockResolvedValue(overThreshold());
    openAiService.generateStructured.mockRejectedValue(new AssistantUnavailableException(true));

    await expect(service.summarizeIfNeeded(conversation)).rejects.toBeInstanceOf(
      AssistantUnavailableException,
    );
    expect(conversationService.saveSummary).not.toHaveBeenCalled();
  });
});

describe('summaryModelInput', () => {
  it('sends the earlier summary and only the role and text of the messages as JSON', () => {
    const input = summaryModelInput(null, [
      buildMessage({
        content: 'No salmon please',
        menuVersion: { menuId: 'menu', compositionSnapshot: { days: [] } },
      }),
    ]);

    expect(input).toEqual([
      {
        role: 'user',
        content:
          '{"earlierSummary":null,"messages":[{"role":"user","content":"No salmon please"}]}',
      },
    ]);
  });
});
