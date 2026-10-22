import { Intent, MessageRole } from '../../../src/common/constants';
import { IntentResultSchema } from '../../../src/common/contracts';
import { OpenAiService } from '../../../src/providers/open-ai/open-ai.service';
import { createMock } from '../../../src/test/create-mock';
import { loadCases } from '../../lib/cases';
import {
  IntentCase,
  IntentCaseSchema,
  intentSuite,
  mentions,
  parseDays,
  scoreIntent,
} from './intent.suite';

describe('intent suite', () => {
  const testCase = (expected: IntentCase['expected']): IntentCase => ({
    id: 'c',
    tags: [],
    profile: 'basic',
    messages: [{ role: MessageRole.User, content: 'x' }],
    expected,
  });

  describe('parseDays', () => {
    it.each([
      ['Plan a 3-day menu', 3],
      ['Plan a menu for 5 days', 5],
      ['Plan a one-day menu', 1],
      ['Plan a menu for a single day', 1],
      ['Plan a 10 day menu without pork', 10],
      ['Plan meals for two weeks', 14],
      ['Plan a 1-week menu', 7],
      ['Plan a weekly menu', 7],
      ['Plan a meal plan for a month', 30],
      ['Plan a menu for the weekend', 2],
      ['Plan a menu for tomorrow', 1],
      ['Plan a menu for a day', 1],
      ['Plan a gluten-free menu around 1800 kcal a day for 2 days', 2],
      ['Plan three meals a day for 5 days', 5],
      ['Plan a menu for a week', 7],
      ['Eat 2000 kcal a day', null],
      ['Plan a vegetarian menu with breakfast and dinner', null],
      ['Склади меню на 3 дні', null],
      ['', null],
      [null, null],
    ])('reads %p as %p days', (request, days) => {
      expect(parseDays(request)).toBe(days);
    });
  });

  describe('scoreIntent', () => {
    it('scores only the intent when the case expects nothing else', () => {
      expect(
        scoreIntent(testCase({ intent: Intent.OutOfScope }), {
          intent: Intent.GeneralChat,
          request: null,
        }),
      ).toEqual([
        { field: 'intent', pass: false, expected: 'out_of_scope', actual: 'general_chat' },
      ]);
    });

    it('scores the days and the constraints of the restated request', () => {
      const scores = scoreIntent(
        testCase({
          intent: Intent.GenerateMenu,
          days: 3,
          constraints: [['!meat', 'vegetarian'], ['!Fish']],
        }),
        { intent: Intent.GenerateMenu, request: 'Plan a 3-day Vegetarian menu without fish' },
      );

      expect(scores).toEqual([
        { field: 'intent', pass: true, expected: 'generate_menu', actual: 'generate_menu' },
        { field: 'days', pass: true, expected: 3, actual: 3 },
        {
          field: 'constraints',
          pass: true,
          expected: [['!meat', 'vegetarian'], ['!Fish']],
          actual: 'Plan a 3-day Vegetarian menu without fish',
        },
      ]);
    });

    it('fails a constraint the request does not name and days the user did not give', () => {
      const [, days, constraints] = scoreIntent(
        testCase({ intent: Intent.GenerateMenu, days: null, constraints: [['!gluten'], ['!nut']] }),
        { intent: Intent.GenerateMenu, request: 'Plan a one-day gluten-free menu' },
      );

      expect(days).toMatchObject({ pass: false, expected: null, actual: 1 });
      expect(constraints.pass).toBe(false);
    });

    it('fails the days and the constraints without a request', () => {
      const scores = scoreIntent(
        testCase({ intent: Intent.GenerateMenu, days: 2, constraints: [['!fish']] }),
        { intent: Intent.Clarification, request: null },
      );

      expect(scores.map((score) => score.pass)).toEqual([false, false, false]);
    });

    it('fails every field on output that did not match the schema', () => {
      const scores = scoreIntent(
        testCase({ intent: Intent.GenerateMenu, days: null, constraints: [['!fish']] }),
        null,
      );

      expect(scores).toEqual([
        { field: 'intent', pass: false, expected: 'generate_menu', actual: null },
        { field: 'days', pass: false, expected: null, actual: null },
        { field: 'constraints', pass: false, expected: [['!fish']], actual: null },
      ]);
    });

    it('fails a request that names the opposite of a constraint', () => {
      const [, constraints] = scoreIntent(
        testCase({ intent: Intent.GenerateMenu, constraints: [['!meat', 'vegetarian']] }),
        { intent: Intent.GenerateMenu, request: 'Plan a weekly menu with meat' },
      );

      expect(constraints.pass).toBe(false);
    });
  });

  describe('mentions', () => {
    it.each([
      ['Plan a menu without meat', 'meat'],
      ['Plan a meat-free menu', 'meat'],
      ['Plan a dairy free menu', 'dairy'],
      ['Plan a gluten-free menu', 'gluten'],
      ['Plan a menu with no fish, dairy or nuts', 'nut'],
      ['Plan a menu with no fish, dairy or nuts', 'dairy'],
      ['Plan a menu without added sugar', 'sugar'],
      ['Plan a menu excluding pork', 'pork'],
      ['Plan a non-vegetarian menu', 'vegetarian'],
    ])('reads %p as excluding %p', (text, term) => {
      expect(mentions(text, term, true)).toBe(true);
      expect(mentions(text, term, false)).toBe(false);
    });

    it.each([
      ['Plan a weekly menu with meat', 'meat'],
      ['Plan a vegetarian menu', 'vegetarian'],
      ['Plan a menu without chicken, rich in protein', 'protein'],
      ['Plan a menu with no fish but with eggs', 'egg'],
      ['Plan a 3-day high-protein menu', 'protein'],
    ])('reads %p as wanting %p', (text, term) => {
      expect(mentions(text, term, false)).toBe(true);
      expect(mentions(text, term, true)).toBe(false);
    });

    it('finds nothing in a text without the term', () => {
      expect(mentions('Plan a menu', 'fish', true)).toBe(false);
      expect(mentions('Plan a menu', 'fish', false)).toBe(false);
    });

    it('treats the term as text, not a pattern', () => {
      expect(mentions('Around 1,800 kcal', '1,800', false)).toBe(true);
      expect(mentions('Plan a menu', 'a.*', false)).toBe(false);
    });
  });

  it('runs the classifier call of the app with the profile of the case', async () => {
    const openAi = createMock<OpenAiService>();
    const result = {
      output: { intent: Intent.GeneralChat, request: null },
      modelId: 'm',
      latencyMs: 1,
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
    };
    openAi.generateStructuredResult.mockResolvedValue(result);

    await expect(
      intentSuite.run(
        { ...testCase({ intent: Intent.GeneralChat }), profile: 'vegetarian' },
        openAi,
      ),
    ).resolves.toBe(result);

    const [[input, schema, options]] = openAi.generateStructuredResult.mock.calls;
    expect(input).toEqual([
      { role: 'user', content: expect.stringContaining('"diets":["vegetarian"]') },
      { role: 'user', content: 'x' },
    ]);
    expect(schema).toBe(IntentResultSchema);
    expect(options).toMatchObject({ maxOutputTokens: expect.any(Number) });
  });

  it('rejects a case whose latest message is not from the user', () => {
    const parsed = IntentCaseSchema.safeParse({
      id: 'c',
      messages: [{ role: 'assistant', content: 'Hi' }],
      expected: { intent: 'general_chat' },
    });

    expect(parsed.success).toBe(false);
  });

  describe('cases.jsonl', () => {
    const cases = loadCases(intentSuite.casesFile, intentSuite.caseSchema);
    const tagged = (tag: string): IntentCase[] => cases.filter((c) => c.tags.includes(tag));

    it('has about 50 cases in Ukrainian and English', () => {
      expect(cases.length).toBeGreaterThanOrEqual(50);
      expect(tagged('uk').length).toBeGreaterThanOrEqual(20);
      expect(tagged('en').length).toBeGreaterThanOrEqual(20);
      expect(cases.every((c) => c.tags.includes('uk') || c.tags.includes('en'))).toBe(true);
    });

    it.each(['direct', 'vague', 'long', 'no-days', 'surzhyk', 'out-of-scope'])(
      'covers %s requests',
      (tag) => {
        expect(tagged(tag).length).toBeGreaterThanOrEqual(5);
      },
    );

    it('expects more than 7 days in the long cases and no days in the no-days cases', () => {
      expect(tagged('long').every((c) => (c.expected.days ?? 0) > 7)).toBe(true);
      expect(tagged('no-days').every((c) => c.expected.days === null)).toBe(true);
    });
  });
});
