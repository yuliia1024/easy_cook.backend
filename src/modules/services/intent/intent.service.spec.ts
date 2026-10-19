import {
  INTENT_HISTORY_LIMIT,
  INTENT_INSTRUCTIONS,
  INTENT_MAX_OUTPUT_TOKENS,
  Intent,
  MessageRole,
} from '../../../common/constants';
import { IntentResultSchema } from '../../../common/contracts';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
} from '../../../common/exceptions';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { createMock } from '../../../test/create-mock';
import { buildMessage, CONVERSATION_ID } from '../../../test/fixtures';
import { ConversationService } from '../conversation/conversation.service';
import { IntentService } from './intent.service';

describe('IntentService', () => {
  let conversationService: jest.Mocked<ConversationService>;
  let openAiService: jest.Mocked<OpenAiService>;
  let service: IntentService;

  beforeEach(() => {
    conversationService = createMock<ConversationService>();
    conversationService.getRecentMessages.mockResolvedValue([buildMessage({ content: 'Hi' })]);
    openAiService = createMock<OpenAiService>();
    service = new IntentService(conversationService, openAiService);
  });

  it('classifies the latest message with the recent history, its own instructions and schema', async () => {
    conversationService.getRecentMessages.mockResolvedValue([
      buildMessage({ content: 'Plan a day' }),
      buildMessage({ role: MessageRole.Assistant, content: 'No recipes' }),
      buildMessage({ content: 'done do it again' }),
    ]);
    const result = { intent: Intent.GenerateMenu, request: 'Plan a one-day menu.' };
    openAiService.generateStructured.mockResolvedValue(result);
    const abort = new AbortController();

    await expect(service.classify(CONVERSATION_ID, abort.signal)).resolves.toEqual(result);
    expect(conversationService.getRecentMessages).toHaveBeenCalledWith(
      CONVERSATION_ID,
      INTENT_HISTORY_LIMIT,
    );
    expect(openAiService.generateStructured).toHaveBeenCalledWith(
      [
        { role: 'user', content: 'Plan a day' },
        { role: 'assistant', content: 'No recipes' },
        { role: 'user', content: 'done do it again' },
      ],
      IntentResultSchema,
      {
        instructions: INTENT_INSTRUCTIONS,
        maxOutputTokens: INTENT_MAX_OUTPUT_TOKENS,
        abortSignal: abort.signal,
      },
    );
  });

  it('rethrows invalid model output instead of guessing an intent', async () => {
    openAiService.generateStructured.mockRejectedValue(new AssistantInvalidOutputException());

    await expect(service.classify(CONVERSATION_ID)).rejects.toBeInstanceOf(
      AssistantInvalidOutputException,
    );
  });

  it('rethrows an API failure', async () => {
    openAiService.generateStructured.mockRejectedValue(new AssistantUnavailableException(false));

    await expect(service.classify(CONVERSATION_ID)).rejects.toBeInstanceOf(
      AssistantUnavailableException,
    );
  });

  it('accepts only the known intents with a request or null', () => {
    expect(IntentResultSchema.safeParse({ intent: 'general_chat', request: null }).success).toBe(
      true,
    );
    expect(
      IntentResultSchema.safeParse({ intent: 'generate_menu', request: 'Plan a day' }).success,
    ).toBe(true);
    expect(IntentResultSchema.safeParse({ intent: 'general_chat' }).success).toBe(false);
    expect(
      IntentResultSchema.safeParse({ intent: 'delete_everything', request: null }).success,
    ).toBe(false);
    expect(IntentResultSchema.safeParse({}).success).toBe(false);
  });
});
