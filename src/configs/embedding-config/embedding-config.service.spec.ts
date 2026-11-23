import { EMBEDDING_MODELS, EmbeddingProviderName } from '../../common/constants';
import { fakeConfig } from '../../test/fake-config';
import { ModelProvidersConfigService } from '../model-providers-config/model-providers-config.service';
import { EmbeddingConfigService } from './embedding-config.service';

describe('EmbeddingConfigService', () => {
  const build = (values: Parameters<typeof fakeConfig>[0]): EmbeddingConfigService => {
    const config = fakeConfig({ OPEN_AI_API_KEY: 'sk-test', ...values });
    return new EmbeddingConfigService(config, new ModelProvidersConfigService(config));
  };

  it.each([undefined, ''])(
    'tries the local Ollama, then OpenAI, when EMBEDDING_PROVIDERS is %p',
    (value) => {
      const config = build({ EMBEDDING_PROVIDERS: value });

      expect(config.providers).toEqual([
        EmbeddingProviderName.Ollama,
        EmbeddingProviderName.OpenAi,
      ]);
      expect(config.models).toEqual([
        EMBEDDING_MODELS[EmbeddingProviderName.Ollama],
        EMBEDDING_MODELS[EmbeddingProviderName.OpenAi],
      ]);
    },
  );

  it('keeps the configured order without repeats', () => {
    const config = build({ EMBEDDING_PROVIDERS: 'openai, ollama,openai' });

    expect(config.providers).toEqual([EmbeddingProviderName.OpenAi, EmbeddingProviderName.Ollama]);
    expect(config.models.map(({ id }) => id)).toEqual([
      'text-embedding-3-large',
      'qwen3-embedding:0.6b-q8_0',
    ]);
  });

  it('reads the OpenAI key', () => {
    expect(build({}).openAiApiKey).toBe('sk-test');
  });

  it('reaches Ollama on localhost by default and drops a trailing slash', () => {
    expect(build({}).ollamaBaseUrl).toBe('http://localhost:11434');
    expect(build({ OLLAMA_BASE_URL: 'http://ollama:11434/' }).ollamaBaseUrl).toBe(
      'http://ollama:11434',
    );
  });
});
