import { createOpenAI } from '@ai-sdk/openai';
import { EmbeddingModelV4 } from '@ai-sdk/provider';
import { Logger } from '@nestjs/common';
import { APICallError } from 'ai';
import {
  EMBEDDING_MODELS,
  EMBEDDING_PROVIDER_COOLDOWN_MS,
  EmbeddingProviderName,
} from '../../common/constants';
import {
  EmbeddingDimensionsMismatchException,
  EmbeddingUnavailableException,
} from '../../common/exceptions';
import { EmbeddingConfigService } from '../../configs/embedding-config/embedding-config.service';
import { ModelProvidersConfigService } from '../../configs/model-providers-config/model-providers-config.service';
import { fakeConfig } from '../../test/fake-config';
import { EmbeddingService } from './embedding.service';

type DoEmbed = jest.Mock<
  ReturnType<EmbeddingModelV4['doEmbed']>,
  Parameters<EmbeddingModelV4['doEmbed']>
>;

const fakeModel = (modelId: string, doEmbed: DoEmbed): EmbeddingModelV4 => ({
  specificationVersion: 'v4',
  provider: 'openai.embedding',
  modelId,
  maxEmbeddingsPerCall: 2048,
  supportsParallelCalls: true,
  doEmbed,
});

const ollamaEmbed: DoEmbed = jest.fn();
const openAiEmbed: DoEmbed = jest.fn();
const embedding = jest.fn((id: string) =>
  id === 'qwen3-embedding:0.6b-q8_0' ? fakeModel(id, ollamaEmbed) : fakeModel(id, openAiEmbed),
);

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: jest.fn(() => ({ embedding })),
}));

const LOCAL = 'ollama/qwen3-embedding:0.6b-q8_0@1024';
const OPENAI = 'openai/text-embedding-3-large@1024';
const vector = (dimensions = 1024, value = 0.1): number[] => new Array(dimensions).fill(value);
const answer: DoEmbed['getMockImplementation'] extends () => infer F ? NonNullable<F> : never = ({
  values,
}) =>
  Promise.resolve({ embeddings: values.map(() => vector()), usage: { tokens: 7 }, warnings: [] });
const connectionRefused = (): APICallError =>
  new APICallError({
    message: 'Cannot connect to API: connect ECONNREFUSED',
    url: 'http://localhost:11434/v1/embeddings',
    requestBodyValues: {},
    isRetryable: true,
  });

describe('EmbeddingService', () => {
  const build = (values: Parameters<typeof fakeConfig>[0] = {}): EmbeddingService => {
    const config = fakeConfig({ OPEN_AI_API_KEY: 'sk-test', ...values });
    return new EmbeddingService(
      new EmbeddingConfigService(config, new ModelProvidersConfigService(config)),
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    ollamaEmbed.mockImplementation(answer);
    openAiEmbed.mockImplementation(answer);
  });

  it('builds the local Ollama (OpenAI-compatible API), then OpenAI with its key', () => {
    const service = build({ OLLAMA_BASE_URL: 'http://ollama:11434' });

    expect(createOpenAI).toHaveBeenNthCalledWith(1, {
      baseURL: 'http://ollama:11434/v1',
      apiKey: 'ollama',
    });
    expect(createOpenAI).toHaveBeenNthCalledWith(2, { apiKey: 'sk-test' });
    expect(service.modelKeys).toEqual([LOCAL, OPENAI]);
    expect(service.models).toEqual([
      EMBEDDING_MODELS[EmbeddingProviderName.Ollama],
      EMBEDDING_MODELS[EmbeddingProviderName.OpenAi],
    ]);
  });

  describe('embedQuery', () => {
    it('is served by the local model, with its query prefix and the pinned dimensions', async () => {
      await expect(build().embedQuery('soup')).resolves.toEqual({
        vector: vector(),
        modelKey: LOCAL,
      });

      expect(ollamaEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          values: [`${EMBEDDING_MODELS[EmbeddingProviderName.Ollama].queryPrefix}soup`],
          dimensions: 1024,
        }),
      );
      expect(openAiEmbed).not.toHaveBeenCalled();
    });

    it('falls back to OpenAI when the local model is not there, without retrying it', async () => {
      ollamaEmbed.mockRejectedValue(connectionRefused());

      await expect(build().embedQuery('soup')).resolves.toEqual({
        vector: vector(),
        modelKey: OPENAI,
      });
      expect(ollamaEmbed).toHaveBeenCalledTimes(1);
      expect(openAiEmbed).toHaveBeenCalledWith(expect.objectContaining({ values: ['soup'] }));
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        `embedding falls back from ${LOCAL} to ${OPENAI}`,
      );
    });

    it('skips a failed provider for the cool-down, then tries it again', async () => {
      const now = jest.spyOn(performance, 'now').mockReturnValue(1000);
      const service = build();
      ollamaEmbed.mockRejectedValueOnce(connectionRefused());

      await service.embedQuery('a');
      await service.embedQuery('b');
      expect(ollamaEmbed).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1000 + EMBEDDING_PROVIDER_COOLDOWN_MS + 1);
      await expect(service.embedQuery('c')).resolves.toMatchObject({ modelKey: LOCAL });
      expect(ollamaEmbed).toHaveBeenCalledTimes(2);
      now.mockRestore();
    });

    it('serves from OpenAI alone when configured so', async () => {
      await expect(build({ EMBEDDING_PROVIDERS: 'openai' }).embedQuery('soup')).resolves.toEqual({
        vector: vector(),
        modelKey: OPENAI,
      });
      expect(ollamaEmbed).not.toHaveBeenCalled();
    });

    it('fails with EmbeddingUnavailableException when no provider answers', async () => {
      ollamaEmbed.mockRejectedValue(connectionRefused());
      openAiEmbed.mockRejectedValue(connectionRefused());

      await expect(build().embedQuery('private text')).rejects.toThrow(
        EmbeddingUnavailableException,
      );
      const lines = (Logger.prototype.warn as jest.Mock).mock.calls.map(([line]) => line as string);
      expect(
        lines.some((line) => line.startsWith(`embedding failed model=${LOCAL} inputs=1`)),
      ).toBe(true);
      expect(lines.join('\n')).not.toContain('private text');
    });

    it('never falls back over a vector of the wrong size: that is a wrong model', async () => {
      ollamaEmbed.mockResolvedValue({ embeddings: [vector(768)], warnings: [] });

      await expect(build().embedQuery('soup')).rejects.toThrow(
        EmbeddingDimensionsMismatchException,
      );
      expect(openAiEmbed).not.toHaveBeenCalled();
    });

    it('stops on the caller abort instead of falling back', async () => {
      ollamaEmbed.mockImplementation(
        ({ abortSignal }) =>
          new Promise((_, reject) => {
            if (abortSignal?.aborted) {
              reject(abortSignal.reason);
            }
            abortSignal?.addEventListener('abort', () => reject(abortSignal.reason));
          }),
      );
      const controller = new AbortController();

      const pending = build().embedQuery('soup', controller.signal);
      controller.abort();

      await expect(pending).rejects.toThrow(EmbeddingUnavailableException);
      expect(openAiEmbed).not.toHaveBeenCalled();
    });

    it('logs the model, inputs and tokens, never the text', async () => {
      await build().embedQuery('my secret soup');

      const line = (Logger.prototype.log as jest.Mock).mock.calls[0][0] as string;
      expect(line).toMatch(
        /^embedded model=ollama\/qwen3-embedding:0\.6b-q8_0@1024 inputs=1 tokens=7 ms=\d+$/,
      );
      expect(line).not.toContain('secret');
    });
  });

  describe('embedDocuments', () => {
    it('embeds by the named model, without the query prefix, keeping the order', async () => {
      openAiEmbed.mockResolvedValue({
        embeddings: [vector(1024, 1), vector(1024, 2)],
        usage: { tokens: 11 },
        warnings: [],
      });

      await expect(build().embedDocuments(OPENAI, ['a', 'b'])).resolves.toEqual({
        embeddings: [vector(1024, 1), vector(1024, 2)],
        tokens: 11,
      });
      expect(openAiEmbed.mock.calls[0][0].values).toEqual(['a', 'b']);
      expect(ollamaEmbed).not.toHaveBeenCalled();
    });

    it('does not fall back: each model fills its own index', async () => {
      ollamaEmbed.mockRejectedValue(connectionRefused());

      await expect(build().embedDocuments(LOCAL, ['a'])).rejects.toThrow(
        EmbeddingUnavailableException,
      );
      expect(openAiEmbed).not.toHaveBeenCalled();
    });

    it('makes no call for no texts and rejects an unknown model', async () => {
      await expect(build().embedDocuments(LOCAL, [])).resolves.toEqual({
        embeddings: [],
        tokens: 0,
      });
      await expect(build().embedDocuments('x/y@1', ['a'])).rejects.toThrow(
        'Unknown embedding model',
      );
      expect(ollamaEmbed).not.toHaveBeenCalled();
    });

    it('rejects vectors of another size: a wrong model would poison the index', async () => {
      ollamaEmbed.mockResolvedValue({ embeddings: [vector(768)], warnings: [] });

      await expect(build().embedDocuments(LOCAL, ['a'])).rejects.toThrow(
        EmbeddingDimensionsMismatchException,
      );
    });
  });
});
