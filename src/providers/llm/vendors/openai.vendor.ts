import { createOpenAI } from '@ai-sdk/openai';
import { ModelProviderName, OPEN_AI_MODEL } from '../../../common/constants';
import { ModelVendor } from './model-vendor';

/** Responses API; one tool call per step, so the tools run in the order the model chose. */
export const OPEN_AI_VENDOR: ModelVendor = {
  name: ModelProviderName.OpenAi,
  model: OPEN_AI_MODEL,
  apiKey: (config) => config.openAiApiKey,
  connect: (apiKey) => {
    const client = createOpenAI({ apiKey });
    return (modelId) => client.responses(modelId);
  },
  providerOptions: { openai: { parallelToolCalls: false } },
};
