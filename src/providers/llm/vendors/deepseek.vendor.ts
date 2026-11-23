import { createDeepSeek } from '@ai-sdk/deepseek';
import { DEEPSEEK_MODEL, ModelProviderName } from '../../../common/constants';
import { ModelVendor } from './model-vendor';

/**
 * Chat API. It cannot be asked for one tool call per step (`toolCallConcurrency` runs its calls one
 * by one); V4 thinks by default, which a fallback has no time for.
 */
export const DEEPSEEK_VENDOR: ModelVendor = {
  name: ModelProviderName.DeepSeek,
  model: DEEPSEEK_MODEL,
  apiKey: (config) => config.deepSeekApiKey,
  connect: (apiKey) => {
    const client = createDeepSeek({ apiKey });
    return (modelId) => client.chat(modelId);
  },
  providerOptions: { deepseek: { thinking: { type: 'disabled' } } },
};
