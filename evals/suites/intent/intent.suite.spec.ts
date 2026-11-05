import { Intent, MealType, MenuTargetScope, MessageRole } from '../../../src/common/constants';
import { IntentResult, IntentResultSchema, MenuTarget } from '../../../src/common/contracts';
import { OpenAiService } from '../../../src/providers/open-ai/open-ai.service';
import { createMock } from '../../../src/test/create-mock';
import { loadCases } from '../../lib/cases';
import { IntentCase, IntentCaseSchema, intentSuite, mentions, scoreIntent } from './intent.suite';

describe('intent suite', () => {
  const testCase = (expected: IntentCase['expected']): IntentCase => ({
    id: 'c',
    tags: [],
    profile: 'basic',
    messages: [{ role: MessageRole.User, content: 'x' }],
    expected,
  });
  const menuRequest = (days: number | null): IntentResult['menuRequest'] => ({
    days,
    mealTypes: [],
    caloriesKcal: null,
    diets: [],
    excludedIngredients: [],
    dislikedFoods: [],
  });
  const output = (
    intent: Intent,
    request: string | null,
    overrides: Partial<IntentResult> = {},
  ): IntentResult => ({ intent, request, menuRequest: null, targets: null, ...overrides });

  describe('scoreIntent', () => {
    it('scores only the intent when the case expects nothing else', () => {
      expect(
        scoreIntent(testCase({ intent: Intent.OutOfScope }), output(Intent.GeneralChat, null)),
      ).toEqual([
        { field: 'intent', pass: false, expected: 'out_of_scope', actual: 'general_chat' },
      ]);
    });

    it('scores the days of the menu request and the constraints of the restated request', () => {
      const scores = scoreIntent(
        testCase({
          intent: Intent.GenerateMenu,
          days: 3,
          constraints: [['!meat', 'vegetarian'], ['!Fish']],
        }),
        output(Intent.GenerateMenu, 'Plan a 3-day Vegetarian menu without fish', {
          menuRequest: menuRequest(3),
        }),
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
        output(Intent.GenerateMenu, 'Plan a one-day gluten-free menu', {
          menuRequest: menuRequest(1),
        }),
      );

      expect(days).toMatchObject({ pass: false, expected: null, actual: 1 });
      expect(constraints.pass).toBe(false);
    });

    it('fails the days and the constraints without a menu request', () => {
      const scores = scoreIntent(
        testCase({ intent: Intent.GenerateMenu, days: 2, constraints: [['!fish']] }),
        output(Intent.Clarification, null),
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

    it('scores the scope of the targets and the fields the case sets', () => {
      const revision = (targets: IntentResult['targets']): IntentResult =>
        output(Intent.ReviseMenu, 'Plan a 3-day menu with another lunch', { targets });
      const meal = testCase({
        intent: Intent.ReviseMenu,
        targets: [{ scope: MenuTargetScope.Meal, mealType: MealType.Lunch }],
      });

      expect(
        scoreIntent(
          meal,
          revision([{ scope: MenuTargetScope.Meal, dayIndex: 2, mealType: MealType.Lunch }]),
        )[1],
      ).toEqual({
        field: 'target',
        pass: true,
        expected: [{ scope: 'meal', mealType: 'lunch' }],
        actual: [{ scope: 'meal', dayIndex: 2, mealType: 'lunch' }],
      });
      expect(
        scoreIntent(
          meal,
          revision([{ scope: MenuTargetScope.Meal, dayIndex: null, mealType: MealType.Dinner }]),
        )[1].pass,
      ).toBe(false);
      expect(
        scoreIntent(
          testCase({
            intent: Intent.ReviseMenu,
            targets: [{ scope: MenuTargetScope.Day, dayIndex: 1 }],
          }),
          revision([{ scope: MenuTargetScope.Day, dayIndex: 0, mealType: null }]),
        )[1].pass,
      ).toBe(false);
      expect(scoreIntent(meal, revision(null))[1].pass).toBe(false);
    });

    it('scores the targets as the app reads them on the menu of the case', () => {
      const lunch = (dayIndex: number | null): MenuTarget => ({
        scope: MenuTargetScope.Meal,
        dayIndex,
        mealType: MealType.Lunch,
      });
      const anyLunch = testCase({
        intent: Intent.ReviseMenu,
        targets: [{ scope: MenuTargetScope.Meal, dayIndex: null, mealType: MealType.Lunch }],
      });
      const everyLunch = output(Intent.ReviseMenu, 'Another lunch', {
        targets: [lunch(0), lunch(1), lunch(2)],
      });

      expect(scoreIntent({ ...anyLunch, menuDays: 3 }, everyLunch)[1]).toMatchObject({
        pass: true,
        actual: [lunch(null)],
      });
      expect(scoreIntent(anyLunch, everyLunch)[1].pass).toBe(false);
      expect(scoreIntent({ ...anyLunch, menuDays: 4 }, everyLunch)[1].pass).toBe(false);
    });

    it('scores every target in any order, one for each', () => {
      const day = (dayIndex: number): MenuTarget => ({
        scope: MenuTargetScope.Day,
        dayIndex,
        mealType: null,
      });
      const twoDays = testCase({
        intent: Intent.ReviseMenu,
        targets: [
          { scope: MenuTargetScope.Day, dayIndex: 0 },
          { scope: MenuTargetScope.Day, dayIndex: 3 },
        ],
      });
      const scored = (targets: MenuTarget[]): boolean =>
        scoreIntent(twoDays, output(Intent.ReviseMenu, 'Redo', { targets }))[1].pass;

      expect(scored([day(3), day(0)])).toBe(true);
      expect(scored([day(0)])).toBe(false);
      expect(scored([day(0), day(0)])).toBe(false);
      expect(scored([day(0), day(3), day(4)])).toBe(false);
    });

    it('fails a request that names the opposite of a constraint', () => {
      const [, constraints] = scoreIntent(
        testCase({ intent: Intent.GenerateMenu, constraints: [['!meat', 'vegetarian']] }),
        output(Intent.GenerateMenu, 'Plan a weekly menu with meat'),
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
      output: output(Intent.GeneralChat, null),
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
    ).resolves.toEqual(result);

    const [[input, schema, options]] = openAi.generateStructuredResult.mock.calls;
    expect(input).toEqual([
      { role: 'user', content: expect.stringContaining('"diets":["vegetarian"]') },
      { role: 'user', content: 'x' },
    ]);
    expect(schema).toBe(IntentResultSchema);
    expect(options).toMatchObject({ maxOutputTokens: expect.any(Number) });
  });

  it('applies the rules of the app to the model output', async () => {
    const openAi = createMock<OpenAiService>();
    openAi.generateStructuredResult.mockResolvedValue({
      output: output(Intent.ReviseMenu, 'Plan a weekly menu', {
        menuRequest: menuRequest(7),
        targets: [{ scope: MenuTargetScope.Menu, dayIndex: null, mealType: null }],
      }),
      modelId: 'm',
      latencyMs: 1,
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
    });

    const { output: result } = await intentSuite.run(
      testCase({ intent: Intent.GenerateMenu }),
      openAi,
    );

    expect(result).toMatchObject({ intent: Intent.GenerateMenu, targets: null });
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
