import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAI } from '@ai-sdk/openai';
import {
  ANTHROPIC_MODEL,
  DEEPSEEK_MODEL,
  ModelProviderName,
  OPEN_AI_MODEL,
} from '../../../common/constants';
import { ModelProvidersConfigService } from '../../../configs/model-providers-config/model-providers-config.service';
import { fakeConfig } from '../../../test/fake-config';
import { MODEL_VENDORS } from '.';

const responses = jest.fn((modelId: string) => ({ api: 'responses', modelId }));
const chat = jest.fn((modelId: string) => ({ api: 'chat', modelId }));
const messages = jest.fn((modelId: string) => ({ api: 'messages', modelId }));

jest.mock('@ai-sdk/openai', () => ({ createOpenAI: jest.fn(() => ({ responses })) }));
jest.mock('@ai-sdk/deepseek', () => ({ createDeepSeek: jest.fn(() => ({ chat })) }));
jest.mock('@ai-sdk/anthropic', () => ({ createAnthropic: jest.fn(() => ({ messages })) }));

describe('MODEL_VENDORS', () => {
  const config = new ModelProvidersConfigService(
    fakeConfig({ OPEN_AI_API_KEY: 'sk-o', DEEPSEEK_API_KEY: 'sk-d', ANTHROPIC_API_KEY: 'sk-a' }),
  );

  it('has a vendor for every provider, under its name', () => {
    for (const name of Object.values(ModelProviderName)) {
      expect(MODEL_VENDORS[name].name).toBe(name);
    }
  });

  it.each([
    [ModelProviderName.OpenAi, OPEN_AI_MODEL, 'sk-o', createOpenAI, 'responses'],
    [ModelProviderName.DeepSeek, DEEPSEEK_MODEL, 'sk-d', createDeepSeek, 'chat'],
    [ModelProviderName.Anthropic, ANTHROPIC_MODEL, 'sk-a', createAnthropic, 'messages'],
  ])('%s serves its pinned model through its API with its key', (name, model, key, create, api) => {
    const vendor = MODEL_VENDORS[name];

    expect(vendor.model).toBe(model);
    expect(vendor.apiKey(config)).toBe(key);
    expect(vendor.connect(key)('some-model')).toEqual({ api, modelId: 'some-model' });
    expect(create).toHaveBeenCalledWith({ apiKey: key });
  });

  it('has no key of a provider the config leaves out', () => {
    const openAiOnly = new ModelProvidersConfigService(fakeConfig({ OPEN_AI_API_KEY: 'sk-o' }));

    expect(MODEL_VENDORS[ModelProviderName.DeepSeek].apiKey(openAiOnly)).toBeUndefined();
    expect(MODEL_VENDORS[ModelProviderName.Anthropic].apiKey(openAiOnly)).toBeUndefined();
  });

  it('asks OpenAI for one tool call per step and DeepSeek for no thinking', () => {
    expect(MODEL_VENDORS[ModelProviderName.OpenAi].providerOptions).toEqual({
      openai: { parallelToolCalls: false },
    });
    expect(MODEL_VENDORS[ModelProviderName.DeepSeek].providerOptions).toEqual({
      deepseek: { thinking: { type: 'disabled' } },
    });
    expect(MODEL_VENDORS[ModelProviderName.Anthropic].providerOptions).toBeUndefined();
  });
});
