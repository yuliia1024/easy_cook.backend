import { createOpenAI } from '@ai-sdk/openai';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APICallError, LanguageModel } from 'ai';
import { z } from 'zod';
import { OPEN_AI_MODEL } from '../../common/constants';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
} from '../../common/exceptions';
import { OpenAiConfigService } from '../../configs/open-ai-config/open-ai-config.service';
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

const OPTIONS = { instructions: 'Be brief.', maxOutputTokens: 100 };

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
        /^gpt-test resp_1 stop in \d+ms \(first text after none\), tokens: 12 in \(2 cached\) \+ 30 out \(5 reasoning\) = 42$/,
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
        expect.stringMatching(/^gpt-test resp_2 stop in \d+ms, tokens: 12 in/),
      );
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
