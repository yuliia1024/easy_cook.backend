import {
  GENERAL_CHAT_PROMPT,
  GENERAL_CHAT_MAX_OUTPUT_TOKENS,
  Goal,
  MessageRole,
} from '../../../common/constants';
import { ProfileContext } from '../../../common/types';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { createMock } from '../../../test/create-mock';
import { buildMessage, PROFILE_ID } from '../../../test/fixtures';
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
      const history = {
        summary: null,
        messages: [
          buildMessage({ content: 'Hi' }),
          buildMessage({ role: MessageRole.Assistant, content: 'Hello' }),
          buildMessage({ content: 'How are you?' }),
        ],
      };
      const openAiService = createMock<OpenAiService>();
      openAiService.streamText.mockImplementation(async function* () {
        yield 'Fine';
        yield '!';
      });
      const abort = new AbortController();

      const deltas: string[] = [];
      for await (const delta of new GeneralChatService(openAiService).reply(
        history,
        null,
        context,
        abort.signal,
      )) {
        deltas.push(delta);
      }

      expect(deltas).toEqual(['Fine', '!']);
      expect(openAiService.streamText).toHaveBeenCalledWith(
        [
          { role: 'user', content: profileJson },
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello' },
          { role: 'user', content: 'How are you?' },
        ],
        {
          prompt: GENERAL_CHAT_PROMPT,
          maxOutputTokens: GENERAL_CHAT_MAX_OUTPUT_TOKENS,
          abortSignal: abort.signal,
        },
      );
    },
  );

  it('gives the model the menu request and the summary of the conversation', async () => {
    const openAiService = createMock<OpenAiService>();
    openAiService.streamText.mockImplementation(async function* () {
      yield 'Sure';
    });
    const menuRequest = {
      days: 3,
      mealTypes: [],
      caloriesKcal: null,
      diets: [],
      excludedIngredients: ['mushrooms'],
      dislikedFoods: [],
    };
    const history = { summary: 'Rejected the salmon.', messages: [buildMessage()] };

    for await (const _delta of new GeneralChatService(openAiService).reply(
      history,
      menuRequest,
      null,
    )) {
      // drain
    }

    const [[[first]]] = openAiService.streamText.mock.calls as unknown as [[[{ content: string }]]];
    expect(JSON.parse(first.content)).toMatchObject({
      menuRequest,
      earlierConversation: 'Rejected the salmon.',
    });
  });
});
