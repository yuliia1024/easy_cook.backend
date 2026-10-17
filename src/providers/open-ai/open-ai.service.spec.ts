import { createOpenAI } from '@ai-sdk/openai';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LanguageModel } from 'ai';
import { MAX_OUTPUT_TOKENS, OPEN_AI_INSTRUCTIONS, OPEN_AI_MODEL } from '../../common/constants';
import { OpenAiConfigService } from '../../configs/open-ai-config/open-ai-config.service';
import { fakeConfig } from '../../test/fake-config';
import { OpenAiModule } from './open-ai.module';
import { OpenAiService } from './open-ai.service';

type FakeModel = Extract<LanguageModel, { specificationVersion: 'v4' }>;
type StreamPart =
  Awaited<ReturnType<FakeModel['doStream']>>['stream'] extends ReadableStream<infer T> ? T : never;

const doStream = jest.fn<ReturnType<FakeModel['doStream']>, Parameters<FakeModel['doStream']>>();
const model: FakeModel = {
  specificationVersion: 'v4',
  provider: 'openai.responses',
  modelId: 'gpt-test',
  supportedUrls: {},
  doGenerate: () => Promise.reject(new Error('not used')),
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

describe('OpenAiService', () => {
  const openAiConfig = new OpenAiConfigService(fakeConfig({ OPEN_AI_API_KEY: 'sk-test' }));

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
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
      new OpenAiService(openAiConfig).streamText([{ role: 'user', content: 'Tell a story' }]),
    );

    expect(responses).toHaveBeenCalledWith(OPEN_AI_MODEL);
    expect(doStream).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        prompt: [
          { role: 'system', content: OPEN_AI_INSTRUCTIONS },
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

    await collect(new OpenAiService(openAiConfig).streamText('x'));

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

    await collect(new OpenAiService(openAiConfig).streamText('x'));

    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /length in \d+ms \(first text after \d+ms\), tokens: unknown; reason: max_output_tokens$/,
      ),
    );
  });

  it('throws an error that arrives in the stream', async () => {
    doStream.mockResolvedValue(
      streamOf([...textParts('Once'), { type: 'error', error: new Error('server error') }]),
    );

    await expect(collect(new OpenAiService(openAiConfig).streamText('x'))).rejects.toThrow(
      'server error',
    );
  });

  it('propagates API errors', async () => {
    doStream.mockRejectedValue(new Error('rate limited'));

    await expect(collect(new OpenAiService(openAiConfig).streamText('x'))).rejects.toThrow(
      'rate limited',
    );
  });
});
