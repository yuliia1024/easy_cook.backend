import { z } from 'zod';
import {
  CHAT_TOOL_MAX_STEPS,
  ChatStatusStep,
  ChatStreamEventType,
  ChatToolName,
  GENERAL_CHAT_PROMPT,
  GENERAL_CHAT_MAX_OUTPUT_TOKENS,
  Goal,
  MessageRole,
} from '../../../common/constants';
import { PlanMenuInputSchema, SaveMenuInputSchema } from '../../../common/contracts';
import { ProfileContext } from '../../../common/types';
import { OpenAiService, ToolLoopOptions } from '../../../providers/open-ai/open-ai.service';
import { createMock } from '../../../test/create-mock';
import { buildMessage, CONVERSATION_ID, PROFILE_ID } from '../../../test/fixtures';
import { readTool, serviceCallTool, writeTool } from '../chat-tools/chat-tool-registry';
import { ChatToolsService } from '../chat-tools/chat-tools.service';
import { EMPTY_MENU_REQUEST } from '../menu/menu-request';
import { GeneralChatService } from './general-chat.service';

describe('GeneralChatService', () => {
  const chatToolsService = createMock<ChatToolsService>();
  chatToolsService.tools.mockReturnValue([]);
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
      openAiService.streamWithTools.mockImplementation(async function* () {
        yield 'Fine';
        yield '!';
      });
      const abort = new AbortController();

      const deltas: unknown[] = [];
      for await (const delta of new GeneralChatService(openAiService, chatToolsService).reply(
        history,
        null,
        context,
        CONVERSATION_ID,
        abort.signal,
      )) {
        deltas.push(delta);
      }

      expect(deltas).toEqual(['Fine', '!']);
      expect(chatToolsService.tools).toHaveBeenCalledWith(context, CONVERSATION_ID);
      expect(openAiService.streamWithTools).toHaveBeenCalledWith(
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
          tools: {},
          maxSteps: CHAT_TOOL_MAX_STEPS,
          isDone: expect.any(Function),
        },
      );
    },
  );

  it('gives the model the menu request and the summary of the conversation', async () => {
    const openAiService = createMock<OpenAiService>();
    openAiService.streamWithTools.mockImplementation(async function* () {
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

    for await (const _delta of new GeneralChatService(openAiService, chatToolsService).reply(
      history,
      menuRequest,
      null,
      CONVERSATION_ID,
    )) {
      // drain
    }

    const [[[first]]] = openAiService.streamWithTools.mock.calls as unknown as [
      [[{ content: string }]],
    ];
    expect(JSON.parse(first.content)).toMatchObject({
      menuRequest,
      earlierConversation: 'Rejected the salmon.',
    });
  });

  it('returns the menu tool the model called, which ends the loop', async () => {
    const openAiService = createMock<OpenAiService>();
    const tools = createMock<ChatToolsService>();
    tools.tools.mockReturnValue([
      serviceCallTool({
        name: ChatToolName.PlanMenu,
        description: 'Plans a menu.',
        inputSchema: PlanMenuInputSchema,
      }),
    ]);
    const input = {
      request: 'Plan a 2-day menu.',
      menuRequest: { ...EMPTY_MENU_REQUEST, days: 2 },
    };
    let doneAfterCall: boolean | undefined;
    openAiService.streamWithTools.mockImplementation(async function* (
      _input,
      options: ToolLoopOptions,
    ) {
      yield 'Sure.';
      expect(options.isDone?.()).toBe(false);
      await options.tools[ChatToolName.PlanMenu].execute!(input, {
        toolCallId: '1',
        messages: [],
        context: undefined,
      });
      doneAfterCall = options.isDone?.();
    });

    const reply = new GeneralChatService(openAiService, tools).reply(
      { summary: null, messages: [buildMessage()] },
      null,
      null,
      CONVERSATION_ID,
    );
    const deltas: unknown[] = [];
    let next = await reply.next();
    for (; next.done !== true; next = await reply.next()) {
      deltas.push(next.value);
    }

    expect(deltas).toEqual(['Sure.']);
    expect(doneAfterCall).toBe(true);
    expect(next.value).toEqual({ name: ChatToolName.PlanMenu, input });
  });

  it('returns null when the model called no menu tool', async () => {
    const openAiService = createMock<OpenAiService>();
    openAiService.streamWithTools.mockImplementation(async function* () {
      yield 'Hi';
    });

    const reply = new GeneralChatService(openAiService, chatToolsService).reply(
      { summary: null, messages: [buildMessage()] },
      null,
      null,
      CONVERSATION_ID,
    );
    await reply.next();

    await expect(reply.next()).resolves.toEqual({ done: true, value: null });
  });

  it('streams the status of a tool as soon as it starts, and reports every finished call', async () => {
    const openAiService = createMock<OpenAiService>();
    const tools = createMock<ChatToolsService>();
    let release: () => void = () => undefined;
    const searching = new Promise<void>((resolve) => (release = resolve));
    tools.tools.mockReturnValue([
      readTool({
        name: ChatToolName.SearchRecipes,
        description: 'Searches recipes.',
        inputSchema: z.object({ query: z.string() }),
        execute: async () => {
          await searching;
          return { recipes: [] };
        },
      }),
      readTool({
        name: ChatToolName.CalculateNutrition,
        description: 'Adds up.',
        inputSchema: z.object({}),
        execute: async () => ({ total: {} }),
      }),
      serviceCallTool({
        name: ChatToolName.PlanMenu,
        description: 'Plans a menu.',
        inputSchema: PlanMenuInputSchema,
      }),
    ]);
    const execute = (options: ToolLoopOptions, name: string, args: object): Promise<unknown> =>
      options.tools[name].execute!(args, { toolCallId: name, messages: [], context: undefined });
    openAiService.streamWithTools.mockImplementation(async function* (_input, options) {
      yield 'Let me look. ';
      await execute(options, ChatToolName.SearchRecipes, { query: 'soup' });
      await execute(options, ChatToolName.CalculateNutrition, {});
      await execute(options, ChatToolName.PlanMenu, { request: '' });
      yield 'Done.';
    });
    const onToolCall = jest.fn();

    const reply = new GeneralChatService(openAiService, tools).reply(
      { summary: null, messages: [buildMessage()] },
      null,
      null,
      CONVERSATION_ID,
      undefined,
      onToolCall,
    );

    await expect(reply.next()).resolves.toEqual({ done: false, value: 'Let me look. ' });
    // The search is still running: its status comes before it ends.
    await expect(reply.next()).resolves.toEqual({
      done: false,
      value: { type: ChatStreamEventType.Status, step: ChatStatusStep.SearchingRecipes },
    });
    expect(onToolCall).not.toHaveBeenCalled();
    release();
    const rest: unknown[] = [];
    for (let next = await reply.next(); next.done !== true; next = await reply.next()) {
      rest.push(next.value);
    }

    // The menu tool has no status: the planner reports its own steps.
    expect(rest).toEqual([
      { type: ChatStreamEventType.Status, step: ChatStatusStep.CalculatingNutrition },
      'Done.',
    ]);
    expect(onToolCall.mock.calls.map(([call]) => [call.name, call.error])).toEqual([
      [ChatToolName.SearchRecipes, null],
      [ChatToolName.CalculateNutrition, null],
      [ChatToolName.PlanMenu, 'invalid_arguments'],
    ]);
    expect(onToolCall.mock.calls[0][0]).toMatchObject({
      input: { query: 'soup' },
      output: { recipes: [] },
      durationMs: expect.any(Number),
    });
  });

  it('streams the status of save_menu and its menu_saved event, then the text', async () => {
    const openAiService = createMock<OpenAiService>();
    const tools = createMock<ChatToolsService>();
    const saved = {
      type: ChatStreamEventType.MenuSaved,
      menuId: 'menu-1',
      versionId: 'version-1',
    } as const;
    tools.tools.mockReturnValue([
      writeTool({
        name: ChatToolName.SaveMenu,
        description: 'Saves the menu.',
        inputSchema: SaveMenuInputSchema,
        execute: async () => ({ output: { status: 'saved' }, event: saved }),
      }),
    ]);
    openAiService.streamWithTools.mockImplementation(async function* (_input, options) {
      await options.tools[ChatToolName.SaveMenu].execute!(
        {},
        { toolCallId: '1', messages: [], context: undefined },
      );
      yield 'Saved.';
    });

    const events: unknown[] = [];
    const reply = new GeneralChatService(openAiService, tools).reply(
      { summary: null, messages: [buildMessage({ content: 'Save it' })] },
      null,
      null,
      CONVERSATION_ID,
    );
    let next = await reply.next();
    for (; next.done !== true; next = await reply.next()) {
      events.push(next.value);
    }

    expect(events).toEqual([
      { type: ChatStreamEventType.Status, step: ChatStatusStep.SavingMenu },
      saved,
      'Saved.',
    ]);
    expect(next.value).toBeNull();
  });
});
