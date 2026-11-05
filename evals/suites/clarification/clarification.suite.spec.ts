import { CLARIFICATION_REPLY, Intent, MealType, MessageRole } from '../../../src/common/constants';
import { IntentResult } from '../../../src/common/contracts';
import { EMPTY_MENU_REQUEST } from '../../../src/modules/services/menu/menu-request';
import { OpenAiService } from '../../../src/providers/open-ai/open-ai.service';
import { createMock } from '../../../src/test/create-mock';
import { loadCases } from '../../lib/cases';
import { JUDGE_MODEL } from '../../lib/judge';
import {
  CLARIFICATION_CRITERIA,
  ClarificationCase,
  ClarificationCaseSchema,
  ClarificationOutput,
  clarificationSuite,
  scoreClarification,
} from './clarification.suite';

describe('clarification suite', () => {
  const usage = { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 };
  const testCase = (
    expected: ClarificationCase['expected'],
    overrides: Partial<ClarificationCase> = {},
  ): ClarificationCase => ({
    id: 'c',
    tags: [],
    profile: 'basic',
    chat: null,
    messages: [{ role: MessageRole.User, content: 'Make a menu' }],
    expected,
    ...overrides,
  });
  const passing = Object.fromEntries(
    CLARIFICATION_CRITERIA.map((criterion) => [criterion, { reason: 'ok', pass: true }]),
  ) as NonNullable<ClarificationOutput['verdict']>;
  const asked = (
    missingFields: Array<'days' | 'mealTypes'>,
    verdict: ClarificationOutput['verdict'] = passing,
  ): ClarificationOutput => ({
    intent: Intent.Clarification,
    clarification: { message: CLARIFICATION_REPLY, missingFields },
    known: EMPTY_MENU_REQUEST,
    verdict,
  });
  const classified = (overrides: Partial<IntentResult>): IntentResult => ({
    intent: Intent.Clarification,
    request: null,
    menuRequest: null,
    targets: null,
    ...overrides,
  });

  describe('scoreClarification', () => {
    it('scores the question, its fields and every criterion of the judge', () => {
      const scores = scoreClarification(
        testCase({ clarification: true, missingFields: ['days', 'mealTypes'] }),
        asked(['mealTypes', 'days'], { ...passing, no_repeat: { reason: 'no', pass: false } }),
      );

      expect(scores.map(({ field, pass }) => [field, pass])).toEqual([
        ['clarification', true],
        ['missingFields', true],
        ['judge.asks_for_missing', true],
        ['judge.no_repeat', false],
        ['judge.clear', true],
        ['judge.consistent', true],
      ]);
    });

    it('fails other missing fields and a reply that asks nothing', () => {
      const expected = { clarification: true, missingFields: ['days' as const] };

      expect(scoreClarification(testCase(expected), asked(['mealTypes']))[1].pass).toBe(false);
      const none = scoreClarification(testCase(expected), {
        ...asked([]),
        intent: Intent.GenerateMenu,
        clarification: null,
        verdict: null,
      });
      expect(none.every(({ pass }) => !pass)).toBe(true);
      expect(none[0].actual).toBe(Intent.GenerateMenu);
    });

    it('scores only whether it asked when no question is expected', () => {
      expect(scoreClarification(testCase({ clarification: false }), asked(['days']))).toEqual([
        { field: 'clarification', pass: false, expected: false, actual: CLARIFICATION_REPLY },
      ]);
    });

    it('fails every field on output that did not match the schema', () => {
      const scores = scoreClarification(
        testCase({ clarification: true, missingFields: ['days'] }),
        null,
      );

      expect(scores).toHaveLength(2 + CLARIFICATION_CRITERIA.length);
      expect(scores.every(({ pass }) => !pass)).toBe(true);
    });
  });

  describe('run', () => {
    let openAi: jest.Mocked<OpenAiService>;

    beforeEach(() => {
      openAi = createMock<OpenAiService>();
    });

    it('asks for what the chat lacks and has the judge grade the question', async () => {
      openAi.generateStructuredResult
        .mockResolvedValueOnce({
          output: classified({}),
          modelId: 'gpt-4o-mini',
          latencyMs: 5,
          usage,
        })
        .mockResolvedValueOnce({ output: passing, modelId: 'gpt-4.1', latencyMs: 9, usage });
      const messages = [
        { role: MessageRole.User, content: '3 days' },
        { role: MessageRole.Assistant, content: 'Here is your menu.' },
        { role: MessageRole.User, content: 'Make me a menu' },
      ];

      const result = await clarificationSuite.run(
        testCase({ clarification: true }, { chat: { days: 3 }, messages }),
        openAi,
      );

      expect(result).toEqual({
        output: {
          intent: Intent.Clarification,
          clarification: { message: CLARIFICATION_REPLY, missingFields: ['mealTypes'] },
          known: expect.objectContaining({ days: 3, caloriesKcal: 2000 }),
          verdict: passing,
        },
        modelId: 'gpt-4o-mini',
        latencyMs: 5,
        usage,
        judge: { modelId: 'gpt-4.1', usage },
      });
      const [[intentInput], [judgeInput, , judgeOptions]] =
        openAi.generateStructuredResult.mock.calls;
      expect(intentInput).toContainEqual({
        role: 'user',
        content: expect.stringContaining('"days":3'),
      });
      expect(JSON.parse(judgeInput as string)).toEqual({
        conversation: messages,
        known: expect.objectContaining({ days: 3 }),
        missingFields: ['mealTypes'],
        limits: { minDays: 1, maxDays: 7 },
        reply: CLARIFICATION_REPLY,
      });
      expect(judgeOptions).toMatchObject({ model: JUDGE_MODEL });
    });

    it('offers the nearest days for a menu request out of range', async () => {
      openAi.generateStructuredResult
        .mockResolvedValueOnce({
          output: classified({
            intent: Intent.GenerateMenu,
            request: 'Plan a 10-day menu.',
            menuRequest: { ...EMPTY_MENU_REQUEST, days: 10 },
          }),
          modelId: 'm',
          latencyMs: 1,
          usage,
        })
        .mockResolvedValueOnce({ output: passing, modelId: 'j', latencyMs: 1, usage });

      const { output } = await clarificationSuite.run(
        testCase({ clarification: true, missingFields: ['days'] }),
        openAi,
      );

      expect(output.clarification).toEqual({
        message: 'I can plan a menu for up to 7 days, not 10. Shall I make a 7-day menu?',
        missingFields: ['days'],
      });
    });

    it('plans a clarification the chat can already answer, without the judge', async () => {
      openAi.generateStructuredResult.mockResolvedValueOnce({
        output: classified({}),
        modelId: 'm',
        latencyMs: 1,
        usage,
      });

      const result = await clarificationSuite.run(
        testCase({ clarification: false }, { chat: { days: 3, mealTypes: [MealType.Breakfast] } }),
        openAi,
      );

      expect(result.output).toMatchObject({
        intent: Intent.GenerateMenu,
        clarification: null,
        verdict: null,
      });
      expect(result.judge).toBeUndefined();
      expect(openAi.generateStructuredResult).toHaveBeenCalledTimes(1);
    });

    it('does not judge a question the case does not expect', async () => {
      openAi.generateStructuredResult.mockResolvedValueOnce({
        output: classified({}),
        modelId: 'm',
        latencyMs: 1,
        usage,
      });

      const { output } = await clarificationSuite.run(testCase({ clarification: false }), openAi);

      expect(output.clarification).not.toBeNull();
      expect(output.verdict).toBeNull();
      expect(openAi.generateStructuredResult).toHaveBeenCalledTimes(1);
    });

    it('makes a failed judge a failed call, not invalid output of the prompt', async () => {
      openAi.generateStructuredResult
        .mockResolvedValueOnce({ output: classified({}), modelId: 'm', latencyMs: 1, usage })
        .mockRejectedValueOnce(new Error('timeout'));

      await expect(
        clarificationSuite.run(testCase({ clarification: true }), openAi),
      ).rejects.toThrow('The judge failed: timeout');
    });
  });

  it('rejects missingFields without a clarification', () => {
    expect(
      ClarificationCaseSchema.safeParse({
        id: 'c',
        messages: [{ role: 'user', content: 'Hi' }],
        expected: { clarification: false, missingFields: ['days'] },
      }).success,
    ).toBe(false);
  });

  describe('cases.jsonl', () => {
    const cases = loadCases(clarificationSuite.casesFile, clarificationSuite.caseSchema);
    const tagged = (tag: string): ClarificationCase[] => cases.filter((c) => c.tags.includes(tag));

    it('has cases in Ukrainian and English, with and without a question', () => {
      expect(cases.length).toBeGreaterThanOrEqual(20);
      expect(tagged('uk').length).toBeGreaterThanOrEqual(5);
      expect(tagged('en').length).toBeGreaterThanOrEqual(5);
      expect(cases.filter((c) => !c.expected.clarification)).toEqual(tagged('no-question'));
    });

    it.each(['vague', 'follow-up', 'out-of-range', 'no-question'])('covers %s', (tag) => {
      expect(tagged(tag).length).toBeGreaterThanOrEqual(3);
    });

    it('names the missing fields of every question', () => {
      expect(
        cases.filter((c) => c.expected.clarification).every((c) => c.expected.missingFields),
      ).toBe(true);
    });
  });
});
