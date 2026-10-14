import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import OpenAI from 'openai';
import { MAX_OUTPUT_TOKENS, OPEN_AI_INSTRUCTIONS, OPEN_AI_MODEL } from '../../common/constants';
import { OpenAiConfigService } from '../../configs/open-ai-config/open-ai-config.service';
import { fakeConfig } from '../../test/fake-config';
import { OpenAiModule } from './open-ai.module';
import { OpenAiService } from './open-ai.service';

const create = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ responses: { create } })),
}));

const completed = {
  id: 'resp_1',
  model: 'gpt-test',
  status: 'completed',
  error: null,
  incomplete_details: null,
  usage: {
    input_tokens: 12,
    input_tokens_details: { cached_tokens: 2 },
    output_tokens: 30,
    output_tokens_details: { reasoning_tokens: 5 },
    total_tokens: 42,
  },
};

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

  it('creates the client with OPEN_AI_API_KEY', () => {
    new OpenAiService(openAiConfig);

    expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'sk-test' });
  });

  const collect = async (stream: AsyncIterable<string>): Promise<string[]> => {
    const deltas: string[] = [];
    for await (const delta of stream) {
      deltas.push(delta);
    }
    return deltas;
  };

  it('streams the input to the configured model and yields the text deltas', async () => {
    create.mockResolvedValue(
      (async function* () {
        yield { type: 'response.created' };
        yield { type: 'response.output_text.delta', delta: 'Once upon ' };
        yield { type: 'response.output_text.delta', delta: 'a time...' };
        yield { type: 'response.completed', response: completed };
      })(),
    );

    const deltas = await collect(new OpenAiService(openAiConfig).streamText('Tell a story'));

    expect(create).toHaveBeenCalledWith({
      model: OPEN_AI_MODEL,
      instructions: OPEN_AI_INSTRUCTIONS,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      input: 'Tell a story',
      stream: true,
    });
    expect(deltas).toEqual(['Once upon ', 'a time...']);
  });

  it('logs the token usage of a completed response', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    create.mockResolvedValue(
      (async function* () {
        yield { type: 'response.completed', response: completed };
      })(),
    );

    await collect(new OpenAiService(openAiConfig).streamText('x'));

    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^gpt-test resp_1 completed in \d+ms \(first text after none\), tokens: 12 in \(2 cached\) \+ 30 out \(5 reasoning\) = 42$/,
      ),
    );
  });

  it('warns with the reason when the response is cut short or failed', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    create.mockResolvedValue(
      (async function* () {
        yield { type: 'response.output_text.delta', delta: 'Once' };
        yield {
          type: 'response.incomplete',
          response: {
            ...completed,
            status: 'incomplete',
            usage: undefined,
            incomplete_details: { reason: 'max_output_tokens' },
          },
        };
      })(),
    );

    await collect(new OpenAiService(openAiConfig).streamText('x'));

    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /incomplete in \d+ms \(first text after \d+ms\), tokens: unknown; reason: max_output_tokens$/,
      ),
    );

    create.mockResolvedValue(
      (async function* () {
        yield {
          type: 'response.failed',
          response: { ...completed, status: 'failed', error: { message: 'server error' } },
        };
      })(),
    );

    await collect(new OpenAiService(openAiConfig).streamText('x'));

    expect(warn).toHaveBeenLastCalledWith(
      expect.stringMatching(/failed .*; reason: server error$/),
    );
  });

  it('propagates API errors', async () => {
    create.mockRejectedValue(new Error('rate limited'));

    await expect(collect(new OpenAiService(openAiConfig).streamText('x'))).rejects.toThrow(
      'rate limited',
    );
  });
});
