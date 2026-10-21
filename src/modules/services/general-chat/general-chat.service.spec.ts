import {
  GENERAL_CHAT_HISTORY_LIMIT,
  GENERAL_CHAT_INSTRUCTIONS,
  GENERAL_CHAT_MAX_OUTPUT_TOKENS,
  Goal,
  MessageRole,
} from '../../../common/constants';
import { ProfileContext } from '../../../common/types';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { createMock } from '../../../test/create-mock';
import { buildMessage, CONVERSATION_ID, PROFILE_ID } from '../../../test/fixtures';
import { ConversationService } from '../conversation/conversation.service';
import { GeneralChatService } from './general-chat.service';

describe('GeneralChatService', () => {
  const profile: ProfileContext = {
    profileId: PROFILE_ID,
    goal: Goal.GainMuscle,
    nutritionGoal: null,
    rules: { diets: [], allergies: ['peanut'], excludedIngredients: [], dislikedFoods: [] },
  };

  it.each([
    [
      'a profile',
      profile,
      '{"profile":{"goal":"gain_muscle","dailyTarget":"not set","diets":[],' +
        '"allergies":["peanut"],"excludedIngredients":[],"dislikedFoods":[]}}',
    ],
    [
      'no profile',
      null,
      '{"profile":{"goal":"not set","dailyTarget":"not set","diets":"not set",' +
        '"allergies":"not set","excludedIngredients":"not set","dislikedFoods":"not set"}}',
    ],
  ])(
    'streams the reply to the recent history with the chat instructions and %s',
    async (_case, context, profileJson) => {
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
        context,
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
          { role: 'user', content: profileJson },
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
    },
  );
});
