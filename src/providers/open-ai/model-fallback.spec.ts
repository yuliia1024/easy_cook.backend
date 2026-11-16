import {
  APICallError,
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from '@ai-sdk/provider';
import { Logger } from '@nestjs/common';
import { ModelProviderName } from '../../common/constants';
import { ModelFallback, ModelFallbackSettings, ModelRoute } from './model-fallback';

type Generate = jest.Mock<PromiseLike<LanguageModelV4GenerateResult>, [LanguageModelV4CallOptions]>;
type Stream = jest.Mock<PromiseLike<LanguageModelV4StreamResult>, [LanguageModelV4CallOptions]>;

const fakeModel = (
  provider: string,
): LanguageModelV4 & { doGenerate: Generate; doStream: Stream } => ({
  specificationVersion: 'v4',
  provider,
  modelId: `${provider}-model`,
  supportedUrls: {},
  doGenerate: jest.fn(),
  doStream: jest.fn(),
});

const RESULT: LanguageModelV4GenerateResult = {
  content: [{ type: 'text', text: 'ok' }],
  finishReason: { unified: 'stop', raw: 'stop' },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
  warnings: [],
};
const OPTIONS: LanguageModelV4CallOptions = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
};
const TEXT: LanguageModelV4StreamPart[] = [
  { type: 'stream-start', warnings: [] },
  { type: 'response-metadata', id: 'r1' },
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: 'Hello' },
  { type: 'text-end', id: 't' },
];

const apiError = (statusCode: number, isRetryable: boolean): APICallError =>
  new APICallError({ message: 'failed', url: 'u', requestBodyValues: {}, statusCode, isRetryable });

const streamOf = (
  parts: LanguageModelV4StreamPart[],
  { end = true } = {},
): LanguageModelV4StreamResult => ({
  stream: new ReadableStream({
    start(controller): void {
      parts.forEach((part) => controller.enqueue(part));
      if (end) {
        controller.close();
      }
    },
  }),
});

/** Never answers; rejects once the request is aborted, as fetch does. */
const hanging = <T>(options: LanguageModelV4CallOptions): Promise<T> =>
  new Promise((_, reject) =>
    options.abortSignal?.addEventListener('abort', () => reject(new Error('aborted'))),
  );

const read = async (stream: ReadableStream<LanguageModelV4StreamPart>): Promise<string[]> => {
  const types: string[] = [];
  for await (const part of stream) {
    types.push(part.type === 'text-delta' ? part.delta : part.type);
  }
  return types;
};

describe('ModelFallback', () => {
  const logger = new Logger('test');
  let warn: jest.SpyInstance;
  let openAi: ReturnType<typeof fakeModel>;
  let deepSeek: ReturnType<typeof fakeModel>;
  let routes: ModelRoute[];

  const fallback = (settings: Partial<ModelFallbackSettings> = {}): ModelFallback =>
    new ModelFallback(routes, {
      attemptTimeoutMs: 1000,
      retries: 1,
      retryDelayMs: 1,
      label: 'brief@v1',
      logger,
      ...settings,
    });

  beforeEach(() => {
    warn = jest.spyOn(logger, 'warn').mockImplementation();
    openAi = fakeModel('openai.responses');
    deepSeek = fakeModel('deepseek.chat');
    routes = [
      { provider: ModelProviderName.OpenAi, model: openAi },
      { provider: ModelProviderName.DeepSeek, model: deepSeek },
    ];
  });

  it('needs a route', () => {
    expect(() => new ModelFallback([], fallback()['settings'])).toThrow(/at least one route/);
  });

  it('names itself after the first route', () => {
    expect(fallback()).toMatchObject({
      provider: 'openai.responses',
      modelId: 'openai.responses-model',
    });
  });

  it('serves from the first provider when it answers', async () => {
    openAi.doGenerate.mockResolvedValue(RESULT);
    const model = fallback();

    await expect(model.doGenerate(OPTIONS)).resolves.toBe(RESULT);
    expect(model.served).toEqual([ModelProviderName.OpenAi]);
    expect(deepSeek.doGenerate).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['a 5xx', 503],
    ['a rate limit', 429],
    ['a request timeout', 408],
  ])('retries the provider on %s, then falls back to the next one', async (_case, status) => {
    openAi.doGenerate.mockRejectedValue(apiError(status, true));
    deepSeek.doGenerate.mockResolvedValue(RESULT);
    const model = fallback();

    await expect(model.doGenerate(OPTIONS)).resolves.toBe(RESULT);
    expect(openAi.doGenerate).toHaveBeenCalledTimes(2);
    expect(model.served).toEqual([ModelProviderName.DeepSeek]);
    expect(warn).toHaveBeenNthCalledWith(
      1,
      `brief@v1 openai (openai.responses-model) failed: ${status} failed; retrying`,
    );
    expect(warn).toHaveBeenNthCalledWith(
      2,
      `brief@v1 openai (openai.responses-model) failed: ${status} failed; falling back to deepseek`,
    );
    expect(warn).toHaveBeenLastCalledWith(
      expect.stringMatching(/^brief@v1 served by deepseek \(deepseek.chat-model\) after openai/),
    );
  });

  it('serves from a retry of the same provider', async () => {
    openAi.doGenerate.mockRejectedValueOnce(apiError(500, true)).mockResolvedValue(RESULT);
    const model = fallback();

    await model.doGenerate(OPTIONS);

    expect(model.served).toEqual([ModelProviderName.OpenAi]);
    expect(deepSeek.doGenerate).not.toHaveBeenCalled();
  });

  it('falls back when a provider does not answer in time', async () => {
    openAi.doGenerate.mockImplementation(hanging);
    deepSeek.doGenerate.mockResolvedValue(RESULT);
    const model = fallback({ attemptTimeoutMs: 10, retries: 0 });

    await expect(model.doGenerate(OPTIONS)).resolves.toBe(RESULT);
    expect(warn).toHaveBeenCalledWith(
      'brief@v1 openai (openai.responses-model) failed: No answer within 10ms; falling back to deepseek',
    );
  });

  it('throws the last failure when every provider failed', async () => {
    const last = apiError(502, true);
    openAi.doGenerate.mockRejectedValue(apiError(503, true));
    deepSeek.doGenerate.mockRejectedValue(last);

    await expect(fallback().doGenerate(OPTIONS)).rejects.toBe(last);
    expect(deepSeek.doGenerate).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith(expect.stringMatching(/; no provider left$/));
  });

  it.each([
    ['a request the provider rejects', apiError(400, false)],
    ['an error that is not an API error', new Error('invalid json')],
  ])('ends the call at once on %s', async (_case, error) => {
    openAi.doGenerate.mockRejectedValue(error);

    await expect(fallback().doGenerate(OPTIONS)).rejects.toBe(error);
    expect(openAi.doGenerate).toHaveBeenCalledTimes(1);
    expect(deepSeek.doGenerate).not.toHaveBeenCalled();
  });

  it('ends the call at once when the caller aborts it', async () => {
    const abort = new AbortController();
    const error = apiError(503, true);
    openAi.doGenerate.mockImplementation(async () => {
      abort.abort();
      throw error;
    });

    await expect(fallback().doGenerate({ ...OPTIONS, abortSignal: abort.signal })).rejects.toBe(
      error,
    );
    expect(deepSeek.doGenerate).not.toHaveBeenCalled();
  });

  it('passes the caller abort on to the provider', async () => {
    const abort = new AbortController();
    openAi.doGenerate.mockImplementation(hanging);
    const call = fallback().doGenerate({ ...OPTIONS, abortSignal: abort.signal });

    abort.abort();

    await expect(call).rejects.toThrow('aborted');
    expect(openAi.doGenerate).toHaveBeenCalledTimes(1);
  });

  describe('doStream', () => {
    it('streams every part of the provider that answered', async () => {
      openAi.doStream.mockResolvedValue(streamOf(TEXT));

      const { stream } = await fallback().doStream(OPTIONS);

      expect(await read(stream)).toEqual([
        'stream-start',
        'response-metadata',
        'text-start',
        'Hello',
        'text-end',
      ]);
    });

    it('streams a response with no output', async () => {
      openAi.doStream.mockResolvedValue(streamOf([{ type: 'stream-start', warnings: [] }]));

      const { stream } = await fallback().doStream(OPTIONS);

      expect(await read(stream)).toEqual(['stream-start']);
    });

    it('falls back when the stream fails before its first output', async () => {
      openAi.doStream.mockImplementation(async () =>
        streamOf([
          { type: 'stream-start', warnings: [] },
          { type: 'error', error: { message: 'server_error' } },
        ]),
      );
      deepSeek.doStream.mockResolvedValue(streamOf(TEXT));
      const model = fallback();

      const { stream } = await model.doStream(OPTIONS);

      expect(await read(stream)).toContain('Hello');
      expect(model.served).toEqual([ModelProviderName.DeepSeek]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('failed: Stream failed: [object Object]'),
      );
    });

    it('falls back when the stream has no output in time', async () => {
      openAi.doStream.mockImplementation(async () =>
        streamOf([{ type: 'stream-start', warnings: [] }], { end: false }),
      );
      deepSeek.doStream.mockResolvedValue(streamOf(TEXT));

      const { stream } = await fallback({ attemptTimeoutMs: 10, retries: 0 }).doStream(OPTIONS);

      expect(await read(stream)).toContain('Hello');
    });

    it('keeps an error after the first output in the stream', async () => {
      openAi.doStream.mockResolvedValue(
        streamOf([...TEXT, { type: 'error', error: new Error('cut') }]),
      );

      const { stream } = await fallback({ attemptTimeoutMs: 10 }).doStream(OPTIONS);

      expect(await read(stream)).toEqual([
        'stream-start',
        'response-metadata',
        'text-start',
        'Hello',
        'text-end',
        'error',
      ]);
      expect(deepSeek.doStream).not.toHaveBeenCalled();
    });

    it('does not time out a stream once its output started', async () => {
      openAi.doStream.mockResolvedValue({
        stream: new ReadableStream({
          async start(controller): Promise<void> {
            TEXT.slice(0, 4).forEach((part) => controller.enqueue(part));
            await new Promise((resolve) => setTimeout(resolve, 30));
            controller.enqueue(TEXT[4]);
            controller.close();
          },
        }),
      });

      const { stream } = await fallback({ attemptTimeoutMs: 10 }).doStream(OPTIONS);

      expect(await read(stream)).toContain('text-end');
    });
  });
});
