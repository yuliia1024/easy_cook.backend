import {
  GENERAL_CHAT_HISTORY_LIMIT,
  GENERAL_CHAT_INSTRUCTIONS,
  GENERAL_CHAT_MAX_OUTPUT_TOKENS,
  MessageRole,
} from '../../../common/constants';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { createMock } from '../../../test/create-mock';
import { buildMessage, CONVERSATION_ID } from '../../../test/fixtures';
import { ConversationService } from '../conversation/conversation.service';
import { GeneralChatService } from './general-chat.service';

describe('GeneralChatService', () => {
  it('streams the reply to the recent history with the chat instructions', async () => {
    const conversationService = createMock<ConversationService>();
    conversationService.getRecentMessages.mockResolvedValue([
      buildMessage({ content: 'Hi' }),
      buildMessage({ role: MessageRole.Assistant, content: 'Hello' }),
      buildMessage({ content: 'How are you?' }),
    ]);
    const openAiService = createMock<OpenAiService>();
    openAiService.streamText.mockImplementation(async function* () {
      yield 'Fine';
      yield '!';
    });
    const abort = new AbortController();

    const deltas: string[] = [];
    for await (const delta of new GeneralChatService(conversationService, openAiService).reply(
      CONVERSATION_ID,
      abort.signal,
    )) {
      deltas.push(delta);
    }

    expect(deltas).toEqual(['Fine', '!']);
    expect(conversationService.getRecentMessages).toHaveBeenCalledWith(
      CONVERSATION_ID,
      GENERAL_CHAT_HISTORY_LIMIT,
    );
    expect(openAiService.streamText).toHaveBeenCalledWith(
      [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
        { role: 'user', content: 'How are you?' },
      ],
      {
        instructions: GENERAL_CHAT_INSTRUCTIONS,
        maxOutputTokens: GENERAL_CHAT_MAX_OUTPUT_TOKENS,
        abortSignal: abort.signal,
      },
    );
  });
});
