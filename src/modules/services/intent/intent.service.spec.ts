import {
  INTENT_PROMPT,
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
import { buildMessage, PROFILE_ID } from '../../../test/fixtures';
import { ModelHistory } from '../conversation/conversation.service';
import { intentModelCall, IntentService, resolveIntent } from './intent.service';

describe('IntentService', () => {
  let openAiService: jest.Mocked<OpenAiService>;
  let service: IntentService;
  const profile: ProfileContext = {
    profileId: PROFILE_ID,
    goal: Goal.Maintain,
    nutritionGoal: null,
    rules: { diets: ['vegan'], allergies: [], excludedIngredients: [], dislikedFoods: [] },
  };

  const history = (...messages: ModelHistory['messages']): ModelHistory => ({
    summary: null,
    messages,
  });

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
    targets: [{ scope: MenuTargetScope.Menu, dayIndex: null, mealType: null }],
  };

  beforeEach(() => {
    openAiService = createMock<OpenAiService>();
    service = new IntentService(openAiService);
  });

  it('classifies the latest message with the recent history, the profile, its own instructions and schema', async () => {
    const messages = history(
      buildMessage({ content: 'Plan a day' }),
      buildMessage({ role: MessageRole.Assistant, content: 'No recipes' }),
      buildMessage({ content: 'done do it again' }),
    );
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
      targets: null,
    };
    openAiService.generateStructured.mockResolvedValue(result);
    const abort = new AbortController();

    await expect(service.classify(messages, null, profile, abort.signal)).resolves.toEqual(result);
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
        prompt: INTENT_PROMPT,
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
      targets: null,
    });

    await service.classify(history(buildMessage({ content: 'Hi' })), null, null);

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
    openAiService.generateStructured.mockResolvedValue(revision);

    await expect(
      service.classify(
        history(buildMessage({ content: 'A menu for a week, no chicken' })),
        null,
        profile,
      ),
    ).resolves.toEqual({
      ...revision,
      intent: Intent.GenerateMenu,
      targets: null,
    });
  });

  it('gives the model the menu request and the summary of the conversation', async () => {
    openAiService.generateStructured.mockResolvedValue({
      intent: Intent.GeneralChat,
      request: null,
      menuRequest: null,
      targets: null,
    });

    await service.classify(
      { summary: 'Rejected the salmon.', messages: [buildMessage({ content: 'And now?' })] },
      revision.menuRequest,
      null,
    );

    const [[[first]]] = openAiService.generateStructured.mock.calls as unknown as [
      [[{ content: string }]],
    ];
    expect(JSON.parse(first.content)).toMatchObject({
      menuRequest: revision.menuRequest,
      earlierConversation: 'Rejected the salmon.',
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
      ).toEqual({ intent: Intent.Clarification, request: null, menuRequest: null, targets: null });
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
      expect(resolveIntent({ ...revision, targets: [target] }, history).targets).toEqual([
        { ...target, scope },
      ]);
    });

    it('takes the scope of every target and keeps the result when every one matches', () => {
      const day = { scope: MenuTargetScope.Day, dayIndex: 1, mealType: null };
      const meal = { scope: MenuTargetScope.Day, dayIndex: 4, mealType: MealType.Lunch };
      const matching = { ...revision, targets: [day] };

      expect(resolveIntent({ ...revision, targets: [day, meal] }, history).targets).toEqual([
        day,
        { ...meal, scope: MenuTargetScope.Meal },
      ]);
      expect(resolveIntent(matching, history)).toBe(matching);
      expect(resolveIntent({ ...revision, targets: null }, history).targets).toBeNull();
    });

    it('keeps a meal on every day a change to the whole menu', () => {
      const target = { scope: MenuTargetScope.Menu, dayIndex: null, mealType: MealType.Dinner };

      expect(resolveIntent({ ...revision, targets: [target] }, history).targets).toEqual([target]);
    });

    it('drops the targets of another intent', () => {
      expect(resolveIntent({ ...revision, intent: Intent.GenerateMenu }, history)).toEqual({
        ...revision,
        intent: Intent.GenerateMenu,
        targets: null,
      });
    });

    it('keeps any other intent as it is', () => {
      const result: IntentResult = { ...revision, intent: Intent.GeneralChat, targets: null };

      expect(resolveIntent(result, [{ role: MessageRole.User }])).toBe(result);
    });
  });

  it('rethrows invalid model output instead of guessing an intent', async () => {
    openAiService.generateStructured.mockRejectedValue(new AssistantInvalidOutputException());

    await expect(service.classify(history(buildMessage()), null, profile)).rejects.toBeInstanceOf(
      AssistantInvalidOutputException,
    );
  });

  it('rethrows an API failure', async () => {
    openAiService.generateStructured.mockRejectedValue(new AssistantUnavailableException(false));

    await expect(service.classify(history(buildMessage()), null, profile)).rejects.toBeInstanceOf(
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
        prompt: INTENT_PROMPT,
        maxOutputTokens: INTENT_MAX_OUTPUT_TOKENS,
        abortSignal: undefined,
      },
    });
  });
});
