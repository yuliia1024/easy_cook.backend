import { Logger } from '@nestjs/common';
import { ToolSet } from 'ai';
import { z } from 'zod';
import {
  CHAT_TOOL_FAILED_MESSAGE,
  CHAT_TOOL_SERVICE_CALL_MESSAGE,
  ChatToolErrorCode,
  ChatToolName,
  ChatToolOperation,
} from '../../../common/constants';
import { PlanMenuInputSchema } from '../../../common/contracts';
import {
  FoodItemsNotFoundBadRequestException,
  RecipeNotFoundException,
} from '../../../common/exceptions';
import { EMPTY_MENU_REQUEST } from '../menu/menu-request';
import {
  ChatToolRun,
  readTool,
  serviceCallTool,
  toChatToolError,
  toToolSet,
} from './chat-tool-registry';

describe('chat tool registry', () => {
  const logger = new Logger('test');
  const execute = jest.fn();
  const search = readTool({
    name: ChatToolName.SearchRecipes,
    description: 'Searches recipes.',
    inputSchema: z.object({ query: z.string().min(1), limit: z.number().int().max(10).nullable() }),
    execute,
  });
  const planMenu = serviceCallTool({
    name: ChatToolName.PlanMenu,
    description: 'Plans a menu.',
    inputSchema: PlanMenuInputSchema,
  });
  const plan = { request: 'Plan a 2-day menu.', menuRequest: { ...EMPTY_MENU_REQUEST, days: 2 } };

  let run: ChatToolRun;
  let tools: ToolSet;
  const call = (name: string, args: unknown, abortSignal?: AbortSignal): Promise<unknown> =>
    tools[name].execute!(args, {
      toolCallId: 'call_1',
      messages: [],
      context: undefined,
      abortSignal,
    });

  beforeEach(() => {
    jest.restoreAllMocks();
    execute.mockReset();
    jest.spyOn(logger, 'warn').mockImplementation();
    jest.spyOn(logger, 'error').mockImplementation();
    run = new ChatToolRun();
    tools = toToolSet([search, planMenu], run, logger);
  });

  it('declares every tool with its operation', () => {
    expect(search.operation).toBe(ChatToolOperation.Read);
    expect(planMenu.operation).toBe(ChatToolOperation.ServiceCall);
  });

  it('gives the SDK the description and the JSON schema of the arguments', async () => {
    expect(Object.keys(tools)).toEqual([ChatToolName.SearchRecipes, ChatToolName.PlanMenu]);
    expect(tools[ChatToolName.SearchRecipes].description).toBe('Searches recipes.');
    const schema = await (tools[ChatToolName.SearchRecipes].inputSchema as { jsonSchema: object })
      .jsonSchema;
    expect(schema).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string', minLength: 1 } },
      required: ['query', 'limit'],
    });
  });

  it('rejects tools with the same name', () => {
    expect(() => toToolSet([search, search], run, logger)).toThrow(/unique names/);
  });

  it('runs a read tool with the parsed arguments and returns its result', async () => {
    execute.mockResolvedValue({ recipes: [] });
    const abort = new AbortController();

    await expect(
      call(ChatToolName.SearchRecipes, { query: 'soup', limit: null }, abort.signal),
    ).resolves.toEqual({ recipes: [] });
    expect(execute).toHaveBeenCalledWith({ query: 'soup', limit: null }, abort.signal);
    expect(run.calls).toEqual([
      {
        name: ChatToolName.SearchRecipes,
        input: { query: 'soup', limit: null },
        output: { recipes: [] },
        error: null,
        durationMs: expect.any(Number),
      },
    ]);
  });

  it('returns invalid arguments to the model with the issues, without running the tool', async () => {
    const result = await call(ChatToolName.SearchRecipes, { query: '', limit: 1.5 });

    expect(result).toEqual({
      error: ChatToolErrorCode.InvalidArguments,
      message: expect.stringContaining('call the tool again'),
      issues: [expect.stringMatching(/^query: /), expect.stringMatching(/^limit: /)],
    });
    expect(execute).not.toHaveBeenCalled();
    expect(run.calls).toEqual([
      {
        name: ChatToolName.SearchRecipes,
        input: { query: '', limit: 1.5 },
        output: expect.objectContaining({ error: ChatToolErrorCode.InvalidArguments }),
        error: ChatToolErrorCode.InvalidArguments,
        durationMs: expect.any(Number),
      },
    ]);
  });

  it('returns arguments that are not an object as invalid', async () => {
    await expect(call(ChatToolName.SearchRecipes, 'soup')).resolves.toMatchObject({
      error: ChatToolErrorCode.InvalidArguments,
      issues: [expect.stringMatching(/^\(arguments\): /)],
    });
  });

  it.each([
    [new RecipeNotFoundException(), ChatToolErrorCode.NotFound, 'Recipe not found'],
    [
      new FoodItemsNotFoundBadRequestException(['f1']),
      ChatToolErrorCode.Rejected,
      'Food items not found: f1',
    ],
    [new Error('db password leaked'), ChatToolErrorCode.Failed, CHAT_TOOL_FAILED_MESSAGE],
  ])('maps a thrown %p to %s for the model', async (thrown, error, message) => {
    execute.mockRejectedValue(thrown);

    await expect(call(ChatToolName.SearchRecipes, { query: 'soup', limit: null })).resolves.toEqual(
      { error, message },
    );
  });

  it('logs an unexpected error and keeps it from the model', () => {
    const result = toChatToolError(new Error('secret'), logger);

    expect(JSON.stringify(result)).not.toContain('secret');
    expect(logger.error).toHaveBeenCalledWith(
      'Chat tool failed',
      expect.stringContaining('secret'),
    );
  });

  it('rethrows once the reply is aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    execute.mockRejectedValue(new Error('aborted'));

    await expect(
      call(ChatToolName.SearchRecipes, { query: 'soup', limit: null }, abort.signal),
    ).rejects.toThrow('aborted');
  });

  it('records a valid service call, which ends the run, and does not run anything', async () => {
    expect(run.isDone()).toBe(false);

    await expect(call(ChatToolName.PlanMenu, plan)).resolves.toEqual({
      status: 'accepted',
      message: CHAT_TOOL_SERVICE_CALL_MESSAGE,
    });
    expect(run.serviceCall).toEqual({ name: ChatToolName.PlanMenu, input: plan });
    expect(run.isDone()).toBe(true);
  });

  it('does not record a service call with invalid arguments', async () => {
    await expect(
      call(ChatToolName.PlanMenu, { request: '', menuRequest: { days: 'two' } }),
    ).resolves.toMatchObject({ error: ChatToolErrorCode.InvalidArguments });
    expect(run.isDone()).toBe(false);
  });

  it('rejects a second service call in the same reply', async () => {
    await call(ChatToolName.PlanMenu, plan);

    await expect(
      call(ChatToolName.PlanMenu, { ...plan, request: 'Plan a 3-day menu.' }),
    ).resolves.toMatchObject({ error: ChatToolErrorCode.Rejected });
    expect(run.serviceCall).toEqual({ name: ChatToolName.PlanMenu, input: plan });
  });

  it('tells the listener when a tool starts and what it returned, in order', async () => {
    const heard: string[] = [];
    const listened = new ChatToolRun({
      onToolStart: (name) => heard.push(`start ${name}`),
      onToolEnd: (call) => heard.push(`end ${call.name} ${call.error}`),
    });
    execute.mockImplementation(async () => {
      heard.push('execute');
      return { recipes: [] };
    });
    tools = toToolSet([search, planMenu], listened, logger);

    await call(ChatToolName.SearchRecipes, { query: 'soup', limit: null });
    await call(ChatToolName.PlanMenu, { request: '' });

    expect(heard).toEqual([
      `start ${ChatToolName.SearchRecipes}`,
      'execute',
      `end ${ChatToolName.SearchRecipes} null`,
      `start ${ChatToolName.PlanMenu}`,
      `end ${ChatToolName.PlanMenu} ${ChatToolErrorCode.InvalidArguments}`,
    ]);
  });
});
