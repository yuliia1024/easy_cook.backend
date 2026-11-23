import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { LogLevel } from '@nestjs/common';
import { EmbeddingProviderName, LOG_LEVELS, ModelProviderName } from '../common/constants';
import { Environments } from '../common/types';

/** `https://a.com, http://localhost:5173`: comma separated http(s) origins. */
const ORIGIN_LIST = /^https?:\/\/[^\s,]+(\s*,\s*https?:\/\/[^\s,]+)*$/;
const PROVIDER = `(${Object.values(ModelProviderName).join('|')})`;
/** `openai, deepseek`: comma separated providers; a repeated one counts once. */
const PROVIDER_LIST = new RegExp(`^${PROVIDER}(\\s*,\\s*${PROVIDER})*$`);
const EMBEDDING_PROVIDER = `(${Object.values(EmbeddingProviderName).join('|')})`;
const EMBEDDING_PROVIDER_LIST = new RegExp(
  `^${EMBEDDING_PROVIDER}(\\s*,\\s*${EMBEDDING_PROVIDER})*$`,
);

/**
 * Every environment variable the application reads. Validated once on start-up by
 * `ConfigService`, so a missing value fails the boot instead of the first request.
 */
export class Configs {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number;

  @IsIn(Object.values(Environments))
  ENV: Environments;

  /** `*` (or unset) allows any origin, which production does not accept. */
  @ValidateIf(
    (configs: Configs) =>
      configs.ENV === Environments.PRODUCTION ||
      (configs.CORS_ORIGINS !== undefined &&
        configs.CORS_ORIGINS !== '' &&
        configs.CORS_ORIGINS !== '*'),
  )
  @IsString()
  @Matches(ORIGIN_LIST, {
    message: 'CORS_ORIGINS must be comma separated http(s) origins ("*" only outside production)',
  })
  CORS_ORIGINS?: string;

  @IsOptional()
  @IsBooleanString()
  SWAGGER_ENABLED?: string;

  /** Also read by the Prisma CLI (migrations, seed). */
  @Matches(/^postgres(ql)?:\/\//, { message: 'DATABASE_URL must be a postgres connection url' })
  DATABASE_URL: string;

  /** Required even without openai in `MODEL_PROVIDERS`: a call that names its model (the evals judge) runs on OpenAI. */
  @IsString()
  @IsNotEmpty()
  OPEN_AI_API_KEY: string;

  /** The providers in the order they are tried (`openai` when unset); the first one serves. */
  @IsOptional()
  @Matches(PROVIDER_LIST, {
    message: `MODEL_PROVIDERS must be comma separated providers: ${Object.values(ModelProviderName).join(', ')}`,
  })
  MODEL_PROVIDERS?: string;

  @ValidateIf((configs: Configs) =>
    (configs.MODEL_PROVIDERS ?? '').includes(ModelProviderName.DeepSeek),
  )
  @IsString()
  @IsNotEmpty({ message: 'DEEPSEEK_API_KEY is required when MODEL_PROVIDERS has deepseek' })
  DEEPSEEK_API_KEY?: string;

  @ValidateIf((configs: Configs) =>
    (configs.MODEL_PROVIDERS ?? '').includes(ModelProviderName.Anthropic),
  )
  @IsString()
  @IsNotEmpty({ message: 'ANTHROPIC_API_KEY is required when MODEL_PROVIDERS has anthropic' })
  ANTHROPIC_API_KEY?: string;

  /**
   * Who embeds recipes and search queries, in the order tried (`ollama,openai` when unset): the
   * first that answers serves a query, every one gets its own index.
   */
  @IsOptional()
  @Matches(EMBEDDING_PROVIDER_LIST, {
    message: `EMBEDDING_PROVIDERS must be comma separated providers: ${Object.values(EmbeddingProviderName).join(', ')}`,
  })
  EMBEDDING_PROVIDERS?: string;

  /** The Ollama server of the `ollama` embedding provider (`http://localhost:11434` when unset). */
  @IsOptional()
  @Matches(/^https?:\/\/[^\s]+$/, { message: 'OLLAMA_BASE_URL must be an http(s) url' })
  OLLAMA_BASE_URL?: string;

  /** Minimum level printed (`log` when unset); `debug` adds the SQL queries. */
  @IsOptional()
  @IsIn(LOG_LEVELS)
  LOG_LEVEL?: LogLevel;
}
