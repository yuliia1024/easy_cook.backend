import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAI } from '@ai-sdk/openai';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APICallError, LanguageModel } from 'ai';
import { z } from 'zod';
import {
  ChatToolErrorCode,
  ChatToolName,
  ANTHROPIC_MODEL,
  DEEPSEEK_MODEL,
  ModelProviderName,
  OPEN_AI_MODEL,
} from '../../common/constants';
import { PlanMenuInputSchema } from '../../common/contracts';
import { getModelCalls, runWithRequestId } from '../../common/logger';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
} from '../../common/exceptions';
import { Configs } from '../../configs/configs';
import { ModelProvidersConfigService } from '../../configs/model-providers-config/model-providers-config.service';
import {
  ChatToolRun,
  readTool,
  serviceCallTool,
  toToolSet,
} from '../../modules/services/chat-tools/chat-tool-registry';
import { fakeConfig } from '../../test/fake-config';
import { LlmModule } from './llm.module';
import { LlmService } from './llm.service';

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

const deepSeekGenerate = jest.fn<
  ReturnType<FakeModel['doGenerate']>,
  Parameters<FakeModel['doGenerate']>
>();
const deepSeekStream = jest.fn<
  ReturnType<FakeModel['doStream']>,
  Parameters<FakeModel['doStream']>
>();
const deepSeekModel: FakeModel = {
  specificationVersion: 'v4',
  provider: 'deepseek.chat',
  modelId: 'deepseek-test',
  supportedUrls: {},
  doGenerate: deepSeekGenerate,
  doStream: deepSeekStream,
};
const chat = jest.fn(() => deepSeekModel);

const anthropicGenerate = jest.fn<
  ReturnType<FakeModel['doGenerate']>,
  Parameters<FakeModel['doGenerate']>
>();
const anthropicModel: FakeModel = {
  specificationVersion: 'v4',
  provider: 'anthropic.messages',
  modelId: 'claude-test',
  supportedUrls: {},
  doGenerate: anthropicGenerate,
  doStream: jest.fn(),
};
const messages = jest.fn(() => anthropicModel);

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: jest.fn(() => ({ responses })),
}));
jest.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: jest.fn(() => ({ chat })),
}));
jest.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: jest.fn(() => ({ messages })),
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

describe('LlmService', () => {
  const configOf = (values: Partial<Record<keyof Configs, string>>): ModelProvidersConfigService =>
    new ModelProvidersConfigService(fakeConfig({ OPEN_AI_API_KEY: 'sk-test', ...values }));
  const openAiConfig = configOf({});
  const withFallback = configOf({ MODEL_PROVIDERS: 'openai,deepseek', DEEPSEEK_API_KEY: 'sk-ds' });

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  it('is provided by LlmModule', async () => {
    const module = await Test.createTestingModule({ imports: [LlmModule] })
      .useMocker((token) => (token === ModelProvidersConfigService ? openAiConfig : undefined))
      .compile();

    expect(module.get(LlmService)).toBeInstanceOf(LlmService);
  });

  it('creates the provider with OPEN_AI_API_KEY', () => {
    new LlmService(openAiConfig);

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
      new LlmService(openAiConfig).streamText([{ role: 'user', content: 'Tell a story' }], OPTIONS),
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

    await collect(new LlmService(openAiConfig).streamText('x', OPTIONS));

    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^openai gpt-test brief@v2 step 1 resp_1 stop in \d+ms \(at \d+ms; model \d+ms(, first output after \d+ms)?\), tokens: 12 in \(2 cached\) \+ 30 out \(5 reasoning\) = 42$/,
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

    await collect(new LlmService(openAiConfig).streamText('x', OPTIONS));

    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /step 1 resp_1 length in \d+ms \(at \d+ms; model \d+ms, first output after \d+ms\), tokens: unknown; reason: max_output_tokens$/,
      ),
    );
  });

  it('maps an error that arrives in the stream', async () => {
    doStream.mockResolvedValue(
      streamOf([...textParts('Once'), { type: 'error', error: new Error('server error') }]),
    );

    await expect(collect(new LlmService(openAiConfig).streamText('x', OPTIONS))).rejects.toEqual(
      new AssistantUnavailableException(true),
    );
  });

  it('records every response for the request', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    doStream.mockResolvedValue(
      streamOf([
        ...textParts('Hi'),
        { type: 'finish', usage, finishReason: { unified: 'stop', raw: 'completed' } },
      ]),
    );

    const calls = await runWithRequestId('req-1', async () => {
      await collect(new LlmService(openAiConfig).streamText('x', OPTIONS));
      return getModelCalls();
    });

    expect(calls).toEqual([
      {
        prompt: 'brief@v2',
        provider: ModelProviderName.OpenAi,
        modelId: 'gpt-test',
        step: 1,
        durationMs: expect.any(Number),
        usage: { inputTokens: 12, cachedInputTokens: 2, outputTokens: 30 },
        finishReason: 'stop',
      },
    ]);
  });

  it('logs and records a stream that failed before its response, tokens unknown', async () => {
    doStream.mockResolvedValue(
      streamOf([...textParts('Once'), { type: 'error', error: new Error('server error') }]),
    );

    const calls = await runWithRequestId('req-1', async () => {
      await collect(new LlmService(openAiConfig).streamText('x', OPTIONS)).catch(() => null);
      return getModelCalls();
    });

    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^openai brief@v2 step 1 failed after \d+ms, tokens: unknown$/),
    );
    expect(calls).toEqual([
      expect.objectContaining({ step: 1, usage: null, finishReason: 'failed' }),
    ]);
  });

  it('logs a stream the caller stopped reading as aborted', async () => {
    doStream.mockResolvedValue({
      stream: new ReadableStream({
        start(controller): void {
          textParts('Once', ' upon').forEach((part) => controller.enqueue(part));
        },
      }),
    });

    await runWithRequestId('req-1', async () => {
      for await (const _delta of new LlmService(openAiConfig).streamText('x', OPTIONS)) {
        break;
      }
    });

    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^openai brief@v2 step 1 aborted after \d+ms, tokens: unknown$/),
    );
  });

  it('logs a stream aborted through the signal as aborted', async () => {
    const abort = new AbortController();
    doStream.mockResolvedValue({
      stream: new ReadableStream({
        start(controller): void {
          textParts('Once').forEach((part) => controller.enqueue(part));
        },
      }),
    });

    const stream = new LlmService(openAiConfig).streamText('x', {
      ...OPTIONS,
      abortSignal: abort.signal,
    });
    await stream.next();
    abort.abort();
    await collect(stream).catch(() => null);

    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringMatching(/brief@v2 step 1 aborted after \d+ms, tokens: unknown$/),
    );
  });

  it('keeps whether an API error is retryable', async () => {
    doStream.mockRejectedValue(apiError(false));

    const error = await collect(new LlmService(openAiConfig).streamText('x', OPTIONS)).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(AssistantUnavailableException);
    expect((error as AssistantUnavailableException).retryable).toBe(false);
  });

  it('rethrows the abort of an aborted call as is', async () => {
    const abort = new AbortController();
    abort.abort();
    doGenerate.mockRejectedValue(new Error('aborted'));

    const error = await new LlmService(openAiConfig)
      .generateStructured('x', z.object({}), { ...OPTIONS, abortSignal: abort.signal })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AssistantUnavailableException);
  });

  describe('fallback', () => {
    const generated: Awaited<ReturnType<FakeModel['doGenerate']>> = {
      content: [{ type: 'text', text: '{"ok":true}' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
      response: { id: 'resp_ds', modelId: 'deepseek-test' },
    };
    const down = (): APICallError =>
      new APICallError({
        message: 'Service Unavailable',
        url: 'https://api.openai.com/v1/responses',
        requestBodyValues: {},
        statusCode: 503,
        isRetryable: true,
      });

    beforeEach(() => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });

    it('fails to start with deepseek in MODEL_PROVIDERS but no key', () => {
      expect(() => new LlmService(configOf({ MODEL_PROVIDERS: 'openai,deepseek' }))).toThrow(
        'MODEL_PROVIDERS has deepseek without an API key',
      );
    });

    it('creates the DeepSeek provider with DEEPSEEK_API_KEY', () => {
      new LlmService(withFallback);

      expect(createDeepSeek).toHaveBeenCalledWith({ apiKey: 'sk-ds' });
    });

    it('retries OpenAI once, then answers with DeepSeek, without thinking and SDK retries', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      doGenerate.mockRejectedValue(down());
      deepSeekGenerate.mockResolvedValue(generated);

      const result = await new LlmService(withFallback).generateStructuredResult(
        'Hi',
        z.object({ ok: z.boolean() }),
        OPTIONS,
      );

      expect(result).toMatchObject({ output: { ok: true }, modelId: 'deepseek-test' });
      expect(doGenerate).toHaveBeenCalledTimes(2);
      expect(chat).toHaveBeenCalledWith(DEEPSEEK_MODEL);
      expect(deepSeekGenerate).toHaveBeenCalledTimes(1);
      expect(deepSeekGenerate.mock.calls[0][0].providerOptions).toMatchObject({
        deepseek: { thinking: { type: 'disabled' } },
      });
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/^deepseek deepseek-test brief@v2 /));
    });

    it('streams from DeepSeek when OpenAI fails before the first output', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation();
      doStream.mockImplementation(async () =>
        streamOf([
          { type: 'stream-start', warnings: [] },
          { type: 'error', error: down() },
        ]),
      );
      deepSeekStream.mockImplementation(async () =>
        streamOf([
          ...textParts('From ', 'DeepSeek'),
          { type: 'finish', usage, finishReason: { unified: 'stop', raw: 'stop' } },
        ]),
      );

      const deltas = await collect(new LlmService(withFallback).streamText('x', OPTIONS));

      expect(deltas).toEqual(['From ', 'DeepSeek']);
      expect(doStream).toHaveBeenCalledTimes(2);
    });

    it('does not fall back on a request the provider rejects', async () => {
      doGenerate.mockRejectedValue(apiError(false));

      await expect(
        new LlmService(withFallback).generateStructured('Hi', z.object({}), OPTIONS),
      ).rejects.toEqual(new AssistantUnavailableException(false));
      expect(doGenerate).toHaveBeenCalledTimes(1);
      expect(deepSeekGenerate).not.toHaveBeenCalled();
    });

    it('keeps a call that names its model on that model, without fallback', async () => {
      doGenerate.mockRejectedValue(down());

      await expect(
        new LlmService(withFallback).generateStructured('Hi', z.object({}), {
          ...OPTIONS,
          model: { provider: ModelProviderName.OpenAi, id: 'gpt-judge' },
        }),
      ).rejects.toEqual(new AssistantUnavailableException(true));
      expect(deepSeekGenerate).not.toHaveBeenCalled();
    });

    it('calls a named Anthropic model at the temperature of the call', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation();
      anthropicGenerate.mockResolvedValue({ ...generated, response: { modelId: 'claude-test' } });

      const result = await new LlmService(
        configOf({ ANTHROPIC_API_KEY: 'sk-a' }),
      ).generateStructuredResult('Hi', z.object({ ok: z.boolean() }), {
        ...OPTIONS,
        model: { provider: ModelProviderName.Anthropic, id: ANTHROPIC_MODEL },
        temperature: 0,
      });

      expect(createAnthropic).toHaveBeenCalledWith({ apiKey: 'sk-a' });
      expect(messages).toHaveBeenCalledWith(ANTHROPIC_MODEL);
      expect(anthropicGenerate.mock.calls[0][0].temperature).toBe(0);
      expect(result.modelId).toBe('claude-test');
      expect(doGenerate).not.toHaveBeenCalled();
    });

    it('fails a call to a provider without a key as unavailable', async () => {
      await expect(
        new LlmService(openAiConfig).generateStructured('Hi', z.object({}), {
          ...OPTIONS,
          model: { provider: ModelProviderName.Anthropic, id: ANTHROPIC_MODEL },
        }),
      ).rejects.toBeInstanceOf(AssistantUnavailableException);
    });

    it('serves from DeepSeek alone when MODEL_PROVIDERS is deepseek', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation();
      deepSeekGenerate.mockResolvedValue(generated);

      await new LlmService(
        configOf({ MODEL_PROVIDERS: 'deepseek', DEEPSEEK_API_KEY: 'sk-ds' }),
      ).generateStructured('Hi', z.object({ ok: z.boolean() }), OPTIONS);

      expect(doGenerate).not.toHaveBeenCalled();
    });
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

    it('logs every step with its place in the loop, the wait before it, the model and the tools', async () => {
      doStream
        .mockImplementationOnce(async () =>
          streamOf(toolCallParts(ChatToolName.SearchRecipes, { query: 'soup' })),
        )
        .mockImplementationOnce(async () => answer('Lentil soup.'));
      const run = new ChatToolRun();

      const calls = await runWithRequestId('req-1', async () => {
        await collect(
          new LlmService(openAiConfig).streamWithTools('Soup?', {
            ...OPTIONS,
            tools: toToolSet([searchTool], run, new Logger('test')),
            maxSteps: 5,
          }),
        );
        return getModelCalls();
      });

      const lines = (Logger.prototype.log as jest.Mock).mock.calls.map(([line]) => line);
      expect(lines).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^brief@v2 step 1 called search_recipes \(call_\d+\)$/),
          expect.stringMatching(
            /^openai gpt-test brief@v2 step 1 resp_t tool-calls in \d+ms \(at \d+ms; model \d+ms, first output after \d+ms; tools \d+ms\), tokens: 12 in/,
          ),
          expect.stringMatching(
            /^openai gpt-test brief@v2 step 2 resp_1 stop in \d+ms \(at \d+ms, \d+ms after the step before; model \d+ms, first output after \d+ms\), tokens: 12 in/,
          ),
          expect.stringMatching(/^Chat tool search_recipes \(call_\d+\) ok in \d+ms/),
        ]),
      );
      expect(calls.map(({ step, finishReason }) => ({ step, finishReason }))).toEqual([
        { step: 1, finishReason: 'tool-calls' },
        { step: 2, finishReason: 'stop' },
      ]);
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
        new LlmService(openAiConfig).streamWithTools([{ role: 'user', content: 'Soup?' }], {
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
        new LlmService(openAiConfig).streamWithTools('Soup?', {
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
        new LlmService(openAiConfig).streamWithTools('Soup?', {
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

    it('asks for one tool call per step', async () => {
      doStream.mockImplementationOnce(async () => answer('Hi.'));

      await collect(
        new LlmService(openAiConfig).streamWithTools('Hi', {
          ...OPTIONS,
          tools: toToolSet([searchTool], new ChatToolRun(), new Logger('test')),
          maxSteps: 2,
        }),
      );

      expect(doStream.mock.calls[0][0].providerOptions).toEqual({
        openai: { parallelToolCalls: false },
      });
    });

    it('never calls the model more than maxSteps times', async () => {
      doStream.mockImplementation(async ({ toolChoice }) =>
        toolChoice?.type === 'none'
          ? answer('Done.')
          : streamOf(toolCallParts(ChatToolName.SearchRecipes, { query: 'soup' })),
      );

      await collect(
        new LlmService(openAiConfig).streamWithTools('Soup?', {
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
              wishes: null,
            },
          }),
        ),
      );
      const run = new ChatToolRun();

      await collect(
        new LlmService(openAiConfig).streamWithTools('Plan it', {
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

      const result = await new LlmService(openAiConfig).generateWithToolsResult('Soup?', {
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
        new LlmService(openAiConfig).generateWithToolsResult('Soup?', {
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
          new LlmService(openAiConfig).streamWithTools('Soup?', {
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
        new LlmService(openAiConfig).generateStructured('Hi', schema, OPTIONS),
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
        expect.stringMatching(/^openai gpt-test brief@v2 resp_2 stop in \d+ms, tokens: 12 in/),
      );
    });

    it('returns the model, latency and token usage with the object', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation();
      doGenerate.mockResolvedValue(generated('{"intent":"a"}'));

      const result = await new LlmService(openAiConfig).generateStructuredResult(
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

      await new LlmService(openAiConfig).generateStructured('Hi', schema, {
        ...OPTIONS,
        model: { provider: ModelProviderName.OpenAi, id: 'gpt-judge' },
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

      const { usage } = await new LlmService(openAiConfig).generateStructuredResult(
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
          new LlmService(openAiConfig).generateStructured('Hi', schema, OPTIONS),
        ).rejects.toBeInstanceOf(AssistantInvalidOutputException);
      },
    );

    it.each([['{"intent":"c"}'], ['not json']])(
      'keeps the model and tokens of invalid output %s',
      async (text) => {
        doGenerate.mockResolvedValue(generated(text));

        const error = await new LlmService(openAiConfig)
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

      const error = await new LlmService(openAiConfig)
        .generateStructuredResult('Hi', strict, OPTIONS)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AssistantInvalidOutputException);
      expect((error as AssistantInvalidOutputException).call).toMatchObject({
        modelId: 'gpt-test',
      });
    });

    it('records the response for the request', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation();
      doGenerate.mockResolvedValue(generated('{"intent":"a"}'));

      const calls = await runWithRequestId('req-1', async () => {
        await new LlmService(openAiConfig).generateStructured('Hi', schema, OPTIONS);
        return getModelCalls();
      });

      expect(calls).toEqual([
        expect.objectContaining({
          prompt: 'brief@v2',
          step: 1,
          usage: { inputTokens: 12, cachedInputTokens: 2, outputTokens: 30 },
          finishReason: 'stop',
        }),
      ]);
    });

    it('logs and records a call aborted before its response as aborted', async () => {
      const abort = new AbortController();
      abort.abort();
      doGenerate.mockRejectedValue(new Error('aborted'));

      const calls = await runWithRequestId('req-1', async () => {
        await new LlmService(openAiConfig)
          .generateStructured('Hi', schema, { ...OPTIONS, abortSignal: abort.signal })
          .catch(() => null);
        return getModelCalls();
      });

      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringMatching(/^no provider brief@v2 step 1 aborted after \d+ms, tokens: unknown$/),
      );
      expect(calls).toEqual([expect.objectContaining({ usage: null, finishReason: 'aborted' })]);
    });

    it('maps an API failure', async () => {
      doGenerate.mockRejectedValue(apiError(false));

      await expect(
        new LlmService(openAiConfig).generateStructured('Hi', schema, OPTIONS),
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
