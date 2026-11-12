import {
  CHAT_TOOL_MAX_STEPS,
  ChatToolErrorCode,
  ChatToolName,
  GENERAL_CHAT_PROMPT,
  MessageRole,
} from '../../../src/common/constants';
import { ChatServiceCall } from '../../../src/common/types';
import { EMPTY_MENU_REQUEST } from '../../../src/modules/services/menu/menu-request';
import { OpenAiService, ToolLoopOptions } from '../../../src/providers/open-ai/open-ai.service';
import { ChatToolCall } from '../../../src/modules/services/chat-tools/chat-tool-registry';
import { createMock } from '../../../src/test/create-mock';
import { loadCases } from '../../lib/cases';
import {
  ChatToolsCase,
  ChatToolsOutput,
  chatToolsSuite,
  runChatTools,
  scoreChatTools,
} from './chat-tools.suite';

describe('chat-tools suite', () => {
  const testCase = (expected: ChatToolsCase['expected']): ChatToolsCase => ({
    id: 'c',
    tags: [],
    profile: 'basic',
    messages: [{ role: MessageRole.User, content: 'x' }],
    expected,
  });
  const plan = (days: number | null): ChatServiceCall => ({
    name: ChatToolName.PlanMenu,
    input: { request: 'Plan a menu.', menuRequest: { ...EMPTY_MENU_REQUEST, days } },
  });
  const toolCall = (name: ChatToolName, error: ChatToolErrorCode | null): ChatToolCall => ({
    name,
    input: {},
    output: {},
    error,
    durationMs: 1,
  });
  const output = (overrides: Partial<ChatToolsOutput> = {}): ChatToolsOutput => ({
    reply: '',
    calls: [],
    serviceCall: null,
    ...overrides,
  });

  describe('scoreChatTools', () => {
    it('scores only the service call when the case expects nothing else', () => {
      expect(scoreChatTools(testCase({ serviceCall: null }), output())).toEqual([
        { field: 'serviceCall', pass: true, expected: null, actual: null },
      ]);
      expect(
        scoreChatTools(testCase({ serviceCall: null }), output({ serviceCall: plan(3) }))[0].pass,
      ).toBe(false);
    });

    it('passes the tools only when each was called with valid arguments at least once', () => {
      const expected = testCase({
        serviceCall: null,
        tools: [ChatToolName.SearchRecipes, ChatToolName.GetRecipeDetails],
      });
      const search = toolCall(ChatToolName.SearchRecipes, null);

      expect(
        scoreChatTools(
          expected,
          output({
            calls: [
              search,
              toolCall(ChatToolName.GetRecipeDetails, ChatToolErrorCode.InvalidArguments),
              toolCall(ChatToolName.GetRecipeDetails, null),
            ],
          }),
        )[1].pass,
      ).toBe(true);
      expect(
        scoreChatTools(
          expected,
          output({
            calls: [search, toolCall(ChatToolName.GetRecipeDetails, ChatToolErrorCode.NotFound)],
          }),
        )[1].pass,
      ).toBe(false);
    });

    it('fails noTools on any call', () => {
      const noTools = testCase({ serviceCall: null, noTools: true });

      expect(scoreChatTools(noTools, output())[1].pass).toBe(true);
      expect(
        scoreChatTools(noTools, output({ calls: [toolCall(ChatToolName.SearchRecipes, null)] }))[1]
          .pass,
      ).toBe(false);
    });

    it('fails forbiddenTools on a call of one of them, whatever it returned', () => {
      const notSaving = testCase({ serviceCall: null, forbiddenTools: [ChatToolName.SaveMenu] });

      expect(
        scoreChatTools(
          notSaving,
          output({ calls: [toolCall(ChatToolName.SearchRecipes, null)] }),
        )[1],
      ).toMatchObject({ field: 'forbiddenTools', pass: true });
      expect(
        scoreChatTools(
          notSaving,
          output({ calls: [toolCall(ChatToolName.SaveMenu, ChatToolErrorCode.NotFound)] }),
        )[1].pass,
      ).toBe(false);
    });

    it('scores the days of the menu tool, null when the user named none', () => {
      const [, days] = scoreChatTools(
        testCase({ serviceCall: ChatToolName.PlanMenu, days: 3 }),
        output({ serviceCall: plan(3) }),
      );
      expect(days).toEqual({ field: 'days', pass: true, expected: 3, actual: 3 });
      expect(
        scoreChatTools(
          testCase({ serviceCall: ChatToolName.PlanMenu, days: null }),
          output({ serviceCall: plan(7) }),
        )[1].pass,
      ).toBe(false);
      expect(
        scoreChatTools(testCase({ serviceCall: ChatToolName.PlanMenu, days: null }), output())[1]
          .pass,
      ).toBe(false);
    });

    it('checks what the reply names, case-insensitively, and what it must not', () => {
      const [, mentions, excludes] = scoreChatTools(
        testCase({
          serviceCall: null,
          mentions: [['261', '262'], ['Lentil']],
          excludes: ['peanut butter toast'],
        }),
        output({ reply: 'The lentil soup has 261.5 kcal per serving.' }),
      );
      expect(mentions.pass).toBe(true);
      expect(excludes.pass).toBe(true);

      const [, , excluded] = scoreChatTools(
        testCase({ serviceCall: null, mentions: [['soup']], excludes: ['Peanut Butter Toast'] }),
        output({ reply: 'Try the peanut butter toast.' }),
      );
      expect(excluded.pass).toBe(false);
    });

    it('fails every field without output', () => {
      const scores = scoreChatTools(
        testCase({
          serviceCall: null,
          tools: [ChatToolName.SearchRecipes],
          noTools: true,
          forbiddenTools: [ChatToolName.SaveMenu],
          days: null,
          mentions: [['a']],
          excludes: ['b'],
        }),
        null,
      );
      expect(scores.map(({ field }) => field)).toEqual([
        'serviceCall',
        'tools',
        'noTools',
        'forbiddenTools',
        'days',
        'mentions',
        'excludes',
      ]);
      expect(scores.every(({ pass }) => !pass)).toBe(true);
    });
  });

  describe('runChatTools', () => {
    it('runs the chat call of the app with the catalog tools and records the loop', async () => {
      const openAi = createMock<OpenAiService>();
      openAi.generateWithToolsResult.mockImplementation(async (input, options: ToolLoopOptions) => {
        await options.tools[ChatToolName.SearchRecipes].execute!(
          { query: 'lentil', mealType: null, diet: null, maxKcalPerServing: null, limit: null },
          { toolCallId: '1', messages: [], context: undefined },
        );
        await options.tools[ChatToolName.GetRecipeDetails].execute!(
          { recipeId: 'Lentil soup' },
          { toolCallId: '2', messages: [], context: undefined },
        );
        return {
          output: 'About 262 kcal.',
          modelId: 'gpt-test',
          latencyMs: 5,
          usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 3 },
        };
      });

      const result = await runChatTools(
        {
          ...testCase({ serviceCall: null }),
          messages: [{ role: MessageRole.User, content: 'Hi' }],
        },
        openAi,
      );

      const [input, options] = openAi.generateWithToolsResult.mock.calls[0];
      expect(input).toEqual([
        expect.objectContaining({ role: 'user' }),
        { role: 'user', content: 'Hi' },
      ]);
      expect(options).toMatchObject({ prompt: GENERAL_CHAT_PROMPT, maxSteps: CHAT_TOOL_MAX_STEPS });
      expect(Object.keys(options.tools)).toContain(ChatToolName.PlanMenu);
      expect(result).toMatchObject({
        modelId: 'gpt-test',
        output: {
          reply: 'About 262 kcal.',
          calls: [
            {
              name: ChatToolName.SearchRecipes,
              input: expect.objectContaining({ query: 'lentil' }),
              error: null,
            },
            {
              name: ChatToolName.GetRecipeDetails,
              input: { recipeId: 'Lentil soup' },
              error: ChatToolErrorCode.InvalidArguments,
            },
          ],
          serviceCall: null,
        },
        metrics: { toolCalls: 2, invalidArguments: 1 },
      });
    });
  });

  describe('cases', () => {
    const cases = loadCases(chatToolsSuite.casesFile, chatToolsSuite.caseSchema);
    const tagged = (tag: string): ChatToolsCase[] => cases.filter((c) => c.tags.includes(tag));

    it('cover every tool, menu tools and none, in English and Ukrainian', () => {
      expect(cases.length).toBeGreaterThanOrEqual(20);
      const used = new Set(
        cases.flatMap(({ expected }) => [...(expected.tools ?? []), expected.serviceCall]),
      );
      expect([...used].filter(Boolean).sort()).toEqual(Object.values(ChatToolName).sort());
      expect(tagged('no-tools').length).toBeGreaterThan(0);
      expect(tagged('uk').length).toBeGreaterThan(0);
      expect(cases.every((c) => c.tags.includes('uk') || c.tags.includes('en'))).toBe(true);
    });

    it('have unique ids', () => {
      expect(new Set(cases.map(({ id }) => id)).size).toBe(cases.length);
    });
  });
});
