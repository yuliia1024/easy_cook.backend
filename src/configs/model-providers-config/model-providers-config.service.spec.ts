import { ModelProviderName } from '../../common/constants';
import { fakeConfig } from '../../test/fake-config';
import { ModelProvidersConfigService } from './model-providers-config.service';

describe('ModelProvidersConfigService', () => {
  it('exposes the API keys', () => {
    const config = new ModelProvidersConfigService(
      fakeConfig({
        OPEN_AI_API_KEY: 'sk-test',
        DEEPSEEK_API_KEY: 'sk-ds',
        ANTHROPIC_API_KEY: 'sk-a',
      }),
    );

    expect(config.openAiApiKey).toBe('sk-test');
    expect(config.deepSeekApiKey).toBe('sk-ds');
    expect(config.anthropicApiKey).toBe('sk-a');
  });

  it('treats an empty key as unset', () => {
    const config = new ModelProvidersConfigService(
      fakeConfig({ DEEPSEEK_API_KEY: '', ANTHROPIC_API_KEY: '' }),
    );

    expect(config.deepSeekApiKey).toBeUndefined();
    expect(config.anthropicApiKey).toBeUndefined();
  });

  it.each([undefined, ''])('serves from openai alone when MODEL_PROVIDERS is %p', (value) => {
    expect(
      new ModelProvidersConfigService(fakeConfig({ MODEL_PROVIDERS: value })).providers,
    ).toEqual([ModelProviderName.OpenAi]);
  });

  it('keeps the order of MODEL_PROVIDERS and drops repeats', () => {
    expect(
      new ModelProvidersConfigService(fakeConfig({ MODEL_PROVIDERS: 'deepseek, openai,deepseek' }))
        .providers,
    ).toEqual([ModelProviderName.DeepSeek, ModelProviderName.OpenAi]);
  });
});
