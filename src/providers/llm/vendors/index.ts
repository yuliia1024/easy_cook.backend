import { ModelProviderName } from '../../../common/constants';
import { ANTHROPIC_VENDOR } from './anthropic.vendor';
import { DEEPSEEK_VENDOR } from './deepseek.vendor';
import { ModelVendor } from './model-vendor';
import { OPEN_AI_VENDOR } from './openai.vendor';

export type { ModelVendor } from './model-vendor';

/** Every vendor `MODEL_PROVIDERS` can name. */
export const MODEL_VENDORS: Record<ModelProviderName, ModelVendor> = {
  [ModelProviderName.OpenAi]: OPEN_AI_VENDOR,
  [ModelProviderName.DeepSeek]: DEEPSEEK_VENDOR,
  [ModelProviderName.Anthropic]: ANTHROPIC_VENDOR,
};
