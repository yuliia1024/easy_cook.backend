import {
  INTENT_HISTORY_LIMIT,
  INTENT_INSTRUCTIONS,
  INTENT_MAX_OUTPUT_TOKENS,
  Goal,
  Intent,
  MealType,
  MenuTargetScope,
  MessageRole,
} from '../../../common/constants';
import { IntentResult, IntentResultSchema } from '../../../common/contracts';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
} from '../../../common/exceptions';
import { ProfileContext } from '../../../common/types';
import { OpenAiService } from '../../../providers/open-ai/open-ai.service';
import { createMock } from '../../../test/create-mock';
import { buildMessage, CONVERSATION_ID, PROFILE_ID } from '../../../test/fixtures';
import { ConversationService } from '../conversation/conversation.service';
import { intentModelCall, IntentService, resolveIntent } from './intent.service';

describe('IntentService', () => {
  let conversationService: jest.Mocked<ConversationService>;
  let openAiService: jest.Mocked<OpenAiService>;
  let service: IntentService;
  const profile: ProfileContext = {
    profileId: PROFILE_ID,
    goal: Goal.Maintain,
    nutritionGoal: null,
    rules: { diets: ['vegan'], allergies: [], excludedIngredients: [], dislikedFoods: [] },
  };

  const revision: IntentResult = {
    intent: Intent.ReviseMenu,
    request: 'Plan a 7-day menu without chicken.',
    menuRequest: {
      days: 7,
      mealTypes: [],
      caloriesKcal: null,
      diets: [],
      excludedIngredients: ['chicken'],
      dislikedFoods: [],
    },
    target: { scope: MenuTargetScope.Menu, dayIndex: null, mealType: null },
  };

  beforeEach(() => {
    conversationService = createMock<ConversationService>();
    conversationService.getRecentMessages.mockResolvedValue([buildMessage({ content: 'Hi' })]);
    openAiService = createMock<OpenAiService>();
    service = new IntentService(conversationService, openAiService);
  });

  it('classifies the latest message with the recent history, the profile, its own instructions and schema', async () => {
    conversationService.getRecentMessages.mockResolvedValue([
      buildMessage({ content: 'Plan a day' }),
      buildMessage({ role: MessageRole.Assistant, content: 'No recipes' }),
      buildMessage({ content: 'done do it again' }),
    ]);
    const result = {
      intent: Intent.GenerateMenu,
      request: 'Plan a one-day menu.',
      menuRequest: {
        days: 1,
        mealTypes: [],
        caloriesKcal: null,
        diets: [],
        excludedIngredients: [],
        dislikedFoods: [],
      },
      target: null,
    };
    openAiService.generateStructured.mockResolvedValue(result);
    const abort = new AbortController();

    await expect(service.classify(CONVERSATION_ID, profile, abort.signal)).resolves.toEqual(result);
    expect(conversationService.getRecentMessages).toHaveBeenCalledWith(
      CONVERSATION_ID,
      INTENT_HISTORY_LIMIT,
    );
    expect(openAiService.generateStructured).toHaveBeenCalledWith(
      [
        {
          role: 'user',
          content:
            '{"profile":{"goal":"maintain","dailyTarget":"not set","diets":["vegan"],' +
            '"allergies":[],"excludedIngredients":[],"dislikedFoods":[]}}',
        },
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

  it('classifies without a profile, marking it as not set', async () => {
    openAiService.generateStructured.mockResolvedValue({
      intent: Intent.GeneralChat,
      request: null,
      menuRequest: null,
      target: null,
    });

    await service.classify(CONVERSATION_ID, null);

    const [[input]] = openAiService.generateStructured.mock.calls;
    expect(input).toEqual([
      {
        role: 'user',
        content: expect.stringContaining('"goal":"not set","dailyTarget":"not set"'),
      },
      { role: 'user', content: 'Hi' },
    ]);
  });

  it('turns a revision without an earlier reply into a new menu', async () => {
    conversationService.getRecentMessages.mockResolvedValue([
      buildMessage({ content: 'A menu for a week, no chicken' }),
    ]);
    openAiService.generateStructured.mockResolvedValue(revision);

    await expect(service.classify(CONVERSATION_ID, profile)).resolves.toEqual({
      ...revision,
      intent: Intent.GenerateMenu,
      target: null,
    });
  });

  describe('resolveIntent', () => {
    it('keeps a revision after an assistant reply', () => {
      expect(
        resolveIntent(revision, [
          { role: MessageRole.User },
          { role: MessageRole.Assistant },
          { role: MessageRole.User },
        ]),
      ).toBe(revision);
    });

    it('asks for details on a revision without an earlier reply and without a request', () => {
      expect(
        resolveIntent({ ...revision, request: null, menuRequest: null }, [
          { role: MessageRole.User },
        ]),
      ).toEqual({ intent: Intent.Clarification, request: null, menuRequest: null, target: null });
    });

    const history = [{ role: MessageRole.User }, { role: MessageRole.Assistant }];

    it.each([
      [
        { scope: MenuTargetScope.Menu, dayIndex: 0, mealType: MealType.Dinner },
        MenuTargetScope.Meal,
      ],
      [
        { scope: MenuTargetScope.Day, dayIndex: null, mealType: MealType.Lunch },
        MenuTargetScope.Meal,
      ],
      [{ scope: MenuTargetScope.Menu, dayIndex: 1, mealType: null }, MenuTargetScope.Day],
      [{ scope: MenuTargetScope.Meal, dayIndex: null, mealType: null }, MenuTargetScope.Menu],
    ])('takes the scope of %j from its fields', (target, scope) => {
      expect(resolveIntent({ ...revision, target }, history).target).toEqual({ ...target, scope });
    });

    it('drops a target of another intent', () => {
      expect(resolveIntent({ ...revision, intent: Intent.GenerateMenu }, history)).toEqual({
        ...revision,
        intent: Intent.GenerateMenu,
        target: null,
      });
    });

    it('keeps any other intent as it is', () => {
      const result: IntentResult = { ...revision, intent: Intent.GeneralChat, target: null };

      expect(resolveIntent(result, [{ role: MessageRole.User }])).toBe(result);
    });
  });

  it('rethrows invalid model output instead of guessing an intent', async () => {
    openAiService.generateStructured.mockRejectedValue(new AssistantInvalidOutputException());

    await expect(service.classify(CONVERSATION_ID, profile)).rejects.toBeInstanceOf(
      AssistantInvalidOutputException,
    );
  });

  it('rethrows an API failure', async () => {
    openAiService.generateStructured.mockRejectedValue(new AssistantUnavailableException(false));

    await expect(service.classify(CONVERSATION_ID, profile)).rejects.toBeInstanceOf(
      AssistantUnavailableException,
    );
  });

  it('builds the same call for the evals without a stored conversation', () => {
    expect(intentModelCall(null, [{ role: MessageRole.User, content: 'Hi' }])).toEqual({
      input: [
        { role: 'user', content: expect.stringContaining('"goal":"not set"') },
        { role: 'user', content: 'Hi' },
      ],
      schema: IntentResultSchema,
      options: {
        instructions: INTENT_INSTRUCTIONS,
        maxOutputTokens: INTENT_MAX_OUTPUT_TOKENS,
        abortSignal: undefined,
      },
    });
  });
});
