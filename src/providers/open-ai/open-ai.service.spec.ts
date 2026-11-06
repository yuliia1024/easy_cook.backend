import { createOpenAI } from '@ai-sdk/openai';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APICallError, LanguageModel } from 'ai';
import { z } from 'zod';
import { ChatToolErrorCode, ChatToolName, OPEN_AI_MODEL } from '../../common/constants';
import { PlanMenuInputSchema } from '../../common/contracts';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
} from '../../common/exceptions';
import { OpenAiConfigService } from '../../configs/open-ai-config/open-ai-config.service';
import {
  ChatToolRun,
  readTool,
  serviceCallTool,
  toToolSet,
} from '../../modules/services/chat-tools/chat-tool-registry';
import { fakeConfig } from '../../test/fake-config';
import { OpenAiModule } from './open-ai.module';
import { OpenAiService } from './open-ai.service';

type FakeModel = Extract<LanguageModel, { specificationVersion: 'v4' }>;
type StreamPart =
  Awaited<ReturnType<FakeModel['doStream']>>['stream'] extends ReadableStream<infer T> ? T : never;

const doStream = jest.fn<ReturnType<FakeModel['doStream']>, Parameters<FakeModel['doStream']>>();
const doGenerate = jest.fn<
  ReturnType<FakeModel['doGenerate']>,
  Parameters<FakeModel['doGenerate']>
>();
const model: FakeModel = {
  specificationVersion: 'v4',
  provider: 'openai.responses',
  modelId: 'gpt-test',
  supportedUrls: {},
  doGenerate,
  doStream,
};
const responses = jest.fn(() => model);

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: jest.fn(() => ({ responses })),
}));

const usage = {
  inputTokens: { total: 12, noCache: 10, cacheRead: 2, cacheWrite: undefined },
  outputTokens: { total: 30, text: 25, reasoning: 5 },
};

const streamOf = (parts: StreamPart[]): Awaited<ReturnType<FakeModel['doStream']>> => ({
  stream: new ReadableStream({
    start(controller): void {
      parts.forEach((part) => controller.enqueue(part));
      controller.close();
    },
  }),
});

const textParts = (...deltas: string[]): StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'response-metadata', id: 'resp_1', modelId: 'gpt-test' },
  { type: 'text-start', id: 't' },
  ...deltas.map((delta): StreamPart => ({ type: 'text-delta', id: 't', delta })),
  { type: 'text-end', id: 't' },
];

const OPTIONS = {
  prompt: { name: 'brief', version: 2, instructions: 'Be brief.' },
  maxOutputTokens: 100,
};

describe('OpenAiService', () => {
  const openAiConfig = new OpenAiConfigService(fakeConfig({ OPEN_AI_API_KEY: 'sk-test' }));

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  it('is provided by OpenAiModule', async () => {
    const module = await Test.createTestingModule({ imports: [OpenAiModule] })
      .useMocker((token) => (token === OpenAiConfigService ? openAiConfig : undefined))
      .compile();

    expect(module.get(OpenAiService)).toBeInstanceOf(OpenAiService);
  });

  it('creates the provider with OPEN_AI_API_KEY', () => {
    new OpenAiService(openAiConfig);

    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-test' });
  });

  const collect = async (stream: AsyncIterable<string>): Promise<string[]> => {
    const deltas: string[] = [];
    for await (const delta of stream) {
      deltas.push(delta);
    }
    return deltas;
  };

  it('streams the conversation to the configured model and yields the text deltas', async () => {
    doStream.mockResolvedValue(
      streamOf([
        ...textParts('Once upon ', 'a time...'),
        { type: 'finish', usage, finishReason: { unified: 'stop', raw: 'completed' } },
      ]),
    );

    const deltas = await collect(
      new OpenAiService(openAiConfig).streamText(
        [{ role: 'user', content: 'Tell a story' }],
        OPTIONS,
      ),
    );

    expect(responses).toHaveBeenCalledWith(OPEN_AI_MODEL);
    expect(doStream).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 100,
        prompt: [
          { role: 'system', content: 'Be brief.' },
          { role: 'user', content: [{ type: 'text', text: 'Tell a story' }] },
        ],
      }),
    );
    expect(deltas).toEqual(['Once upon ', 'a time...']);
  });

  it('logs the token usage of a completed response', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    doStream.mockResolvedValue(
      streamOf([
        ...textParts(),
        { type: 'finish', usage, finishReason: { unified: 'stop', raw: 'completed' } },
      ]),
    );

    await collect(new OpenAiService(openAiConfig).streamText('x', OPTIONS));

    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^gpt-test brief@v2 resp_1 stop in \d+ms \(first text after none\), tokens: 12 in \(2 cached\) \+ 30 out \(5 reasoning\) = 42$/,
      ),
    );
  });

  it('warns with the reason when the response is cut short', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    doStream.mockResolvedValue(
      streamOf([
        ...textParts('Once'),
        {
          type: 'finish',
          usage: {
            inputTokens: {
              total: undefined,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: undefined, text: undefined, reasoning: undefined },
          },
          finishReason: { unified: 'length', raw: 'max_output_tokens' },
        },
      ]),
    );

    await collect(new OpenAiService(openAiConfig).streamText('x', OPTIONS));

    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /length in \d+ms \(first text after \d+ms\), tokens: unknown; reason: max_output_tokens$/,
      ),
    );
  });

  it('maps an error that arrives in the stream', async () => {
    doStream.mockResolvedValue(
      streamOf([...textParts('Once'), { type: 'error', error: new Error('server error') }]),
    );

    await expect(collect(new OpenAiService(openAiConfig).streamText('x', OPTIONS))).rejects.toEqual(
      new AssistantUnavailableException(true),
    );
  });

  it('keeps whether an API error is retryable', async () => {
    doStream.mockRejectedValue(apiError(false));

    const error = await collect(new OpenAiService(openAiConfig).streamText('x', OPTIONS)).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(AssistantUnavailableException);
    expect((error as AssistantUnavailableException).retryable).toBe(false);
  });

  it('rethrows the abort of an aborted call as is', async () => {
    const abort = new AbortController();
    abort.abort();
    doGenerate.mockRejectedValue(new Error('aborted'));

    const error = await new OpenAiService(openAiConfig)
      .generateStructured('x', z.object({}), { ...OPTIONS, abortSignal: abort.signal })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AssistantUnavailableException);
  });

  describe('streamWithTools', () => {
    const toolCallParts = (toolName: string, input: object | string): StreamPart[] => [
      { type: 'stream-start', warnings: [] },
      { type: 'response-metadata', id: 'resp_t', modelId: 'gpt-test' },
      {
        type: 'tool-call',
        toolCallId: `call_${doStream.mock.calls.length}`,
        toolName,
        input: typeof input === 'string' ? input : JSON.stringify(input),
      },
      { type: 'finish', usage, finishReason: { unified: 'tool-calls', raw: 'tool_calls' } },
    ];
    const answer = (...deltas: string[]): Awaited<ReturnType<FakeModel['doStream']>> =>
      streamOf([
        ...textParts(...deltas),
        { type: 'finish', usage, finishReason: { unified: 'stop', raw: 'completed' } },
      ]);
    const searchExecute = jest.fn();
    const searchTool = readTool({
      name: ChatToolName.SearchRecipes,
      description: 'Searches recipes.',
      inputSchema: z.object({ query: z.string().min(1) }),
      execute: searchExecute,
    });
    const planTool = serviceCallTool({
      name: ChatToolName.PlanMenu,
      description: 'Plans a menu.',
      inputSchema: PlanMenuInputSchema,
    });
    const sentToModel = (call: number): string =>
      JSON.stringify(doStream.mock.calls[call][0].prompt);

    beforeEach(() => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation();
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      searchExecute.mockResolvedValue({ recipes: [{ name: 'Lentil soup' }] });
    });

    it('feeds invalid arguments back to the model as a tool error and goes on', async () => {
      doStream
        .mockImplementationOnce(async () =>
          streamOf(toolCallParts(ChatToolName.SearchRecipes, { query: '' })),
        )
        .mockImplementationOnce(async () =>
          streamOf(toolCallParts(ChatToolName.SearchRecipes, { query: 'soup' })),
        )
        .mockImplementationOnce(async () => answer('Try the ', 'lentil soup.'));
      const run = new ChatToolRun();

      const deltas = await collect(
        new OpenAiService(openAiConfig).streamWithTools([{ role: 'user', content: 'Soup?' }], {
          ...OPTIONS,
          tools: toToolSet([searchTool], run, new Logger('test')),
          maxSteps: 5,
        }),
      );

      expect(deltas).toEqual(['Try the ', 'lentil soup.']);
      expect(doStream).toHaveBeenCalledTimes(3);
      expect(sentToModel(1)).toContain(ChatToolErrorCode.InvalidArguments);
      expect(searchExecute).toHaveBeenCalledTimes(1);
      expect(searchExecute).toHaveBeenCalledWith({ query: 'soup' }, expect.any(AbortSignal));
      expect(sentToModel(2)).toContain('Lentil soup');
      expect(doStream.mock.calls[0][0].tools).toEqual([
        expect.objectContaining({
          name: ChatToolName.SearchRecipes,
          description: 'Searches recipes.',
        }),
      ]);
    });

    it('feeds arguments that are not JSON and an unknown tool back to the model', async () => {
      doStream
        .mockImplementationOnce(async () =>
          streamOf(toolCallParts(ChatToolName.SearchRecipes, '{"query": ')),
        )
        .mockImplementationOnce(async () => streamOf(toolCallParts('drop_tables', {})))
        .mockImplementationOnce(async () => answer('Sorry.'));

      const deltas = await collect(
        new OpenAiService(openAiConfig).streamWithTools('Soup?', {
          ...OPTIONS,
          tools: toToolSet([searchTool], new ChatToolRun(), new Logger('test')),
          maxSteps: 5,
        }),
      );

      expect(deltas).toEqual(['Sorry.']);
      expect(sentToModel(1)).toContain('Invalid input for tool search_recipes');
      expect(sentToModel(2)).toContain('drop_tables');
      expect(searchExecute).not.toHaveBeenCalled();
    });

    it('stops at maxSteps, the last model call without tools, so the reply ends with text', async () => {
      doStream
        .mockImplementationOnce(async () =>
          streamOf(toolCallParts(ChatToolName.SearchRecipes, { query: 'soup' })),
        )
        .mockImplementationOnce(async () => answer('Here you go.'));

      const deltas = await collect(
        new OpenAiService(openAiConfig).streamWithTools('Soup?', {
          ...OPTIONS,
          tools: toToolSet([searchTool], new ChatToolRun(), new Logger('test')),
          maxSteps: 2,
        }),
      );

      expect(deltas).toEqual(['Here you go.']);
      expect(doStream).toHaveBeenCalledTimes(2);
      expect(doStream.mock.calls[0][0].toolChoice).toEqual({ type: 'auto' });
      expect(doStream.mock.calls[1][0].toolChoice).toEqual({ type: 'none' });
    });

    it('never calls the model more than maxSteps times', async () => {
      doStream.mockImplementation(async () =>
        streamOf(toolCallParts(ChatToolName.SearchRecipes, { query: 'soup' })),
      );

      await collect(
        new OpenAiService(openAiConfig).streamWithTools('Soup?', {
          ...OPTIONS,
          tools: toToolSet([searchTool], new ChatToolRun(), new Logger('test')),
          maxSteps: 3,
        }),
      );

      expect(doStream).toHaveBeenCalledTimes(3);
    });

    it('ends the loop once isDone, after a service call', async () => {
      doStream.mockImplementation(async () =>
        streamOf(
          toolCallParts(ChatToolName.PlanMenu, {
            request: 'Plan a 2-day menu.',
            menuRequest: {
              days: 2,
              mealTypes: [],
              caloriesKcal: null,
              diets: [],
              excludedIngredients: [],
              dislikedFoods: [],
            },
          }),
        ),
      );
      const run = new ChatToolRun();

      await collect(
        new OpenAiService(openAiConfig).streamWithTools('Plan it', {
          ...OPTIONS,
          tools: toToolSet([planTool], run, new Logger('test')),
          maxSteps: 5,
          isDone: () => run.isDone(),
        }),
      );

      expect(doStream).toHaveBeenCalledTimes(1);
      expect(run.serviceCall).toMatchObject({ name: ChatToolName.PlanMenu });
    });

    it('generateWithToolsResult runs the same loop and returns the text with the tokens of every step', async () => {
      doGenerate
        .mockResolvedValueOnce({
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call_1',
              toolName: ChatToolName.SearchRecipes,
              input: '{"query":"soup"}',
            },
          ],
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          usage,
          warnings: [],
          response: { id: 'resp_1', modelId: 'gpt-test' },
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Try the lentil soup.' }],
          finishReason: { unified: 'stop', raw: 'completed' },
          usage,
          warnings: [],
          response: { id: 'resp_2', modelId: 'gpt-test' },
        });

      const result = await new OpenAiService(openAiConfig).generateWithToolsResult('Soup?', {
        ...OPTIONS,
        tools: toToolSet([searchTool], new ChatToolRun(), new Logger('test')),
        maxSteps: 2,
      });

      expect(result).toEqual({
        output: 'Try the lentil soup.',
        modelId: 'gpt-test',
        latencyMs: expect.any(Number),
        usage: { inputTokens: 24, cachedInputTokens: 4, outputTokens: 60 },
      });
      expect(searchExecute).toHaveBeenCalledWith({ query: 'soup' }, expect.any(AbortSignal));
      expect(doGenerate.mock.calls[1][0].toolChoice).toEqual({ type: 'none' });
    });

    it('generateWithToolsResult maps a failed model call', async () => {
      doGenerate.mockRejectedValue(new Error('socket hang up'));

      await expect(
        new OpenAiService(openAiConfig).generateWithToolsResult('Soup?', {
          ...OPTIONS,
          tools: {},
          maxSteps: 2,
        }),
      ).rejects.toBeInstanceOf(AssistantUnavailableException);
    });

    it('maps a failed model call like streamText', async () => {
      doStream.mockRejectedValue(
        new APICallError({
          message: 'down',
          url: 'https://api.openai.com',
          requestBodyValues: {},
          statusCode: 503,
          isRetryable: false,
        }),
      );

      await expect(
        collect(
          new OpenAiService(openAiConfig).streamWithTools('Soup?', {
            ...OPTIONS,
            tools: {},
            maxSteps: 2,
          }),
        ),
      ).rejects.toBeInstanceOf(AssistantUnavailableException);
    });
  });

  describe('generateStructured', () => {
    const schema = z.object({ intent: z.enum(['a', 'b']) });
    const generated = (text: string): Awaited<ReturnType<FakeModel['doGenerate']>> => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'completed' },
      usage,
      warnings: [],
      response: { id: 'resp_2', modelId: 'gpt-test' },
    });

    it('asks for JSON of the schema and returns the parsed object', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      doGenerate.mockResolvedValue(generated('{"intent":"b"}'));

      await expect(
        new OpenAiService(openAiConfig).generateStructured('Hi', schema, OPTIONS),
      ).resolves.toEqual({ intent: 'b' });
      expect(doGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          maxOutputTokens: 100,
          responseFormat: expect.objectContaining({ type: 'json' }),
          prompt: [
            { role: 'system', content: 'Be brief.' },
            { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
          ],
        }),
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(/^gpt-test brief@v2 resp_2 stop in \d+ms, tokens: 12 in/),
      );
    });

    it('returns the model, latency and token usage with the object', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation();
      doGenerate.mockResolvedValue(generated('{"intent":"a"}'));

      const result = await new OpenAiService(openAiConfig).generateStructuredResult(
        'Hi',
        schema,
        OPTIONS,
      );

      expect(result).toEqual({
        output: { intent: 'a' },
        modelId: 'gpt-test',
        latencyMs: expect.any(Number),
        usage: { inputTokens: 12, cachedInputTokens: 2, outputTokens: 30 },
      });
    });

    it('calls another model when the options name one', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation();
      doGenerate.mockResolvedValue(generated('{"intent":"a"}'));

      await new OpenAiService(openAiConfig).generateStructured('Hi', schema, {
        ...OPTIONS,
        model: 'gpt-judge',
      });

      expect(responses).toHaveBeenCalledWith('gpt-judge');
    });

    it('counts usage the API did not report as 0', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      doGenerate.mockResolvedValue({
        ...generated('{"intent":"a"}'),
        usage: {
          inputTokens: {
            total: undefined,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: undefined, text: undefined, reasoning: undefined },
        },
      });

      const { usage } = await new OpenAiService(openAiConfig).generateStructuredResult(
        'Hi',
        schema,
        OPTIONS,
      );

      expect(usage).toEqual({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });
    });

    it.each([['{"intent":"c"}'], ['not json']])(
      'fails with invalid output for %s',
      async (text) => {
        doGenerate.mockResolvedValue(generated(text));

        await expect(
          new OpenAiService(openAiConfig).generateStructured('Hi', schema, OPTIONS),
        ).rejects.toBeInstanceOf(AssistantInvalidOutputException);
      },
    );

    it.each([['{"intent":"c"}'], ['not json']])(
      'keeps the model and tokens of invalid output %s',
      async (text) => {
        doGenerate.mockResolvedValue(generated(text));

        const error = await new OpenAiService(openAiConfig)
          .generateStructuredResult('Hi', schema, OPTIONS)
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(AssistantInvalidOutputException);
        expect((error as AssistantInvalidOutputException).call).toEqual({
          modelId: 'gpt-test',
          usage: { inputTokens: 12, cachedInputTokens: 2, outputTokens: 30 },
        });
      },
    );

    it('keeps the model and tokens when the output fails the schema check after generation', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation();
      doGenerate.mockResolvedValue(generated('{"intent":"a"}'));
      const strict = z.object({ intent: z.enum(['a']) }).refine(() => false);

      const error = await new OpenAiService(openAiConfig)
        .generateStructuredResult('Hi', strict, OPTIONS)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AssistantInvalidOutputException);
      expect((error as AssistantInvalidOutputException).call).toMatchObject({
        modelId: 'gpt-test',
      });
    });

    it('maps an API failure', async () => {
      doGenerate.mockRejectedValue(apiError(false));

      await expect(
        new OpenAiService(openAiConfig).generateStructured('Hi', schema, OPTIONS),
      ).rejects.toEqual(new AssistantUnavailableException(false));
    });
  });
});

function apiError(isRetryable: boolean): APICallError {
  return new APICallError({
    message: 'bad request',
    url: 'https://api.openai.com/v1/responses',
    requestBodyValues: {},
    statusCode: 400,
    isRetryable,
  });
}
