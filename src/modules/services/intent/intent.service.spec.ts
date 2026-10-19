import { INTENT_INSTRUCTIONS, INTENT_MAX_OUTPUT_TOKENS, Intent } from '../../../common/constants';
import { IntentResultSchema } from '../../../common/contracts';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
} from '../../../common/exceptions';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { createMock } from '../../../test/create-mock';
import { IntentService } from './intent.service';

describe('IntentService', () => {
  let openAiService: jest.Mocked<OpenAiService>;
  let service: IntentService;

  beforeEach(() => {
    openAiService = createMock<OpenAiService>();
    service = new IntentService(openAiService);
  });

  it('classifies only the message, with its own instructions and schema', async () => {
    openAiService.generateStructured.mockResolvedValue({ intent: Intent.GenerateMenu });
    const abort = new AbortController();

    await expect(service.classify('Plan 3 days', abort.signal)).resolves.toEqual({
      intent: Intent.GenerateMenu,
    });
    expect(openAiService.generateStructured).toHaveBeenCalledWith(
      [{ role: 'user', content: 'Plan 3 days' }],
      IntentResultSchema,
      {
        instructions: INTENT_INSTRUCTIONS,
        maxOutputTokens: INTENT_MAX_OUTPUT_TOKENS,
        abortSignal: abort.signal,
      },
    );
  });

  it('asks for clarification when the model output is invalid', async () => {
    jest.spyOn(service['logger'], 'warn').mockImplementation();
    openAiService.generateStructured.mockRejectedValue(new AssistantInvalidOutputException());

    await expect(service.classify('???')).resolves.toEqual({ intent: Intent.Clarification });
  });

  it('rethrows an API failure', async () => {
    openAiService.generateStructured.mockRejectedValue(new AssistantUnavailableException(false));

    await expect(service.classify('Hi')).rejects.toBeInstanceOf(AssistantUnavailableException);
  });

  it('accepts only the known intents', () => {
    expect(IntentResultSchema.safeParse({ intent: 'general_chat' }).success).toBe(true);
    expect(IntentResultSchema.safeParse({ intent: 'delete_everything' }).success).toBe(false);
    expect(IntentResultSchema.safeParse({}).success).toBe(false);
  });
});
