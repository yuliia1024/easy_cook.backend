import { Injectable } from '@nestjs/common';
import { DEFAULT_MODEL_PROVIDERS, ModelProviderName } from '../../common/constants';
import { ConfigService } from '../config.service';

/** The LLM providers (`OpenAiService`): their keys and the order they are tried in. */
@Injectable()
export class ModelProvidersConfigService {
  constructor(private readonly configService: ConfigService) {}

  public get openAiApiKey(): string {
    return this.configService.get('OPEN_AI_API_KEY');
  }

  /** Set whenever `providers` has deepseek (`Configs` checks it). */
  public get deepSeekApiKey(): string | undefined {
    return this.configService.get('DEEPSEEK_API_KEY') || undefined;
  }

  /** Set whenever `providers` has anthropic (`Configs` checks it). */
  public get anthropicApiKey(): string | undefined {
    return this.configService.get('ANTHROPIC_API_KEY') || undefined;
  }

  /** `MODEL_PROVIDERS` in order, without repeats; the first one serves, the rest are fallbacks. */
  public get providers(): ModelProviderName[] {
    const value = this.configService.get('MODEL_PROVIDERS');
    if (!value) {
      return [...DEFAULT_MODEL_PROVIDERS];
    }
    return [...new Set(value.split(',').map((name) => name.trim() as ModelProviderName))];
  }
}
