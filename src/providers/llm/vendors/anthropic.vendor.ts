import { createAnthropic } from '@ai-sdk/anthropic';
import { ANTHROPIC_MODEL, ModelProviderName } from '../../../common/constants';
import { ModelVendor } from './model-vendor';

/** Messages API: the evals judge, or a provider of `MODEL_PROVIDERS`. */
export const ANTHROPIC_VENDOR: ModelVendor = {
  name: ModelProviderName.Anthropic,
  model: ANTHROPIC_MODEL,
  apiKey: (config) => config.anthropicApiKey,
  connect: (apiKey) => {
    const client = createAnthropic({ apiKey });
    return (modelId) => client.messages(modelId);
  },
};
