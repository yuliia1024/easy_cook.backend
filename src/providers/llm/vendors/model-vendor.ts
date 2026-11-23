import { LanguageModelV4, SharedV4ProviderOptions } from '@ai-sdk/provider';
import { ModelProviderName } from '../../../common/constants';
import { ModelProvidersConfigService } from '../../../configs/model-providers-config/model-providers-config.service';

/**
 * An LLM API behind `LlmService`: its pinned model, key, client and call options. Only the
 * service and `ModelFallback` see a vendor; a new one is a file here and a line in `MODEL_VENDORS`.
 */
export interface ModelVendor {
  name: ModelProviderName;
  /** The model it serves in `MODEL_PROVIDERS`: a dated snapshot where the vendor has them. */
  model: string;
  /** Undefined when not set; `MODEL_PROVIDERS` may then not name the vendor. */
  apiKey(config: ModelProvidersConfigService): string | undefined;
  /** A client for the key: a model id to its model. */
  connect(apiKey: string): (modelId: string) => LanguageModelV4;
  /** Added to every call the vendor serves, the fallback's included. */
  providerOptions?: SharedV4ProviderOptions;
}
