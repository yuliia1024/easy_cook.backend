import { Injectable } from '@nestjs/common';
import {
  DEFAULT_EMBEDDING_PROVIDERS,
  DEFAULT_OLLAMA_BASE_URL,
  EMBEDDING_MODELS,
  EmbeddingProviderName,
} from '../../common/constants';
import { EmbeddingModelSpec } from '../../common/types';
import { ConfigService } from '../config.service';
import { ModelProvidersConfigService } from '../model-providers-config/model-providers-config.service';

/** The embedding models of the recipe search (`EmbeddingService`), in order, and how to reach them. */
@Injectable()
export class EmbeddingConfigService {
  constructor(
    private readonly configService: ConfigService,
    private readonly modelProviders: ModelProvidersConfigService,
  ) {}

  /** `EMBEDDING_PROVIDERS` in order, without repeats; the first that answers serves. */
  public get providers(): EmbeddingProviderName[] {
    const value = this.configService.get('EMBEDDING_PROVIDERS');
    if (!value) {
      return [...DEFAULT_EMBEDDING_PROVIDERS];
    }
    return [...new Set(value.split(',').map((name) => name.trim() as EmbeddingProviderName))];
  }

  /** The pinned model of every provider, in the same order. */
  public get models(): EmbeddingModelSpec[] {
    return this.providers.map((provider) => EMBEDDING_MODELS[provider]);
  }

  public get openAiApiKey(): string {
    return this.modelProviders.openAiApiKey;
  }

  /** Without a trailing slash. */
  public get ollamaBaseUrl(): string {
    return (this.configService.get('OLLAMA_BASE_URL') || DEFAULT_OLLAMA_BASE_URL).replace(
      /\/+$/,
      '',
    );
  }
}
