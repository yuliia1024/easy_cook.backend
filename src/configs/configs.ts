import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { LogLevel } from '@nestjs/common';
import {
  CookieSameSite,
  EmbeddingProviderName,
  LOG_LEVELS,
  MIN_AUTH_SECRET_LENGTH,
  ModelProviderName,
} from '../common/constants';
import { Environments } from '../common/types';

/** `https://a.com, http://localhost:5173`: comma separated http(s) origins. */
const ORIGIN_LIST = /^https?:\/\/[^\s,]+(\s*,\s*https?:\/\/[^\s,]+)*$/;
const PROVIDER = `(${Object.values(ModelProviderName).join('|')})`;
/** `openai, deepseek`: comma separated providers; a repeated one counts once. */
const PROVIDER_LIST = new RegExp(`^${PROVIDER}(\\s*,\\s*${PROVIDER})*$`);
/** `a@b.com, c@d.org`: comma separated emails. */
const EMAIL_LIST = /^[^\s,@]+@[^\s,@]+(\s*,\s*[^\s,@]+@[^\s,@]+)*$/;
const EMBEDDING_PROVIDER = `(${Object.values(EmbeddingProviderName).join('|')})`;
const EMBEDDING_PROVIDER_LIST = new RegExp(
  `^${EMBEDDING_PROVIDER}(\\s*,\\s*${EMBEDDING_PROVIDER})*$`,
);

/** `redis://` or `rediss://`; outside `ENV=local` with a password (`redis://:secret@host:6379`). */
@ValidatorConstraint({ name: 'redisUrl' })
class RedisUrlRule implements ValidatorConstraintInterface {
  public validate(value: unknown, { object }: ValidationArguments): boolean {
    if (typeof value !== 'string' || !/^rediss?:\/\/\S+$/.test(value)) {
      return false;
    }
    return (
      (object as Configs).ENV === Environments.LOCAL || /^rediss?:\/\/[^/@]*:[^/@]+@/.test(value)
    );
  }

  public defaultMessage(): string {
    return 'REDIS_URL must be a redis:// or rediss:// url, with a password outside ENV=local';
  }
}

/** Validates a variable only when it has a value: `NAME=` in `.env` counts as unset. */
const isSet =
  (key: keyof Configs): ((configs: Configs) => boolean) =>
  (configs: Configs): boolean =>
    configs[key] !== undefined && configs[key] !== '';

/** `true` / `false`; `false` only with `ENV=local` and a SameSite other than `none`. */
@ValidatorConstraint({ name: 'cookieSecure' })
class CookieSecureRule implements ValidatorConstraintInterface {
  public validate(value: unknown, { object }: ValidationArguments): boolean {
    const configs = object as Configs;
    if (value === 'true') {
      return true;
    }
    return (
      value === 'false' &&
      configs.ENV === Environments.LOCAL &&
      (configs.AUTH_COOKIE_SAME_SITE as string | undefined) !== CookieSameSite.None
    );
  }

  public defaultMessage(): string {
    return 'AUTH_COOKIE_SECURE must be true or false; false only with ENV=local and a SameSite other than none';
  }
}

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

  /**
   * The origins of the web app. `*` (or unset) allows the local origins only (localhost), and only
   * with `ENV=local`: every other environment lists its origins.
   */
  @ValidateIf(
    (configs: Configs) =>
      configs.ENV !== Environments.LOCAL ||
      (configs.CORS_ORIGINS !== undefined &&
        configs.CORS_ORIGINS !== '' &&
        configs.CORS_ORIGINS !== '*'),
  )
  @IsString()
  @Matches(ORIGIN_LIST, {
    message: 'CORS_ORIGINS must be comma separated http(s) origins ("*" only with ENV=local)',
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

  /** Langfuse tracing of the model calls is on when the public and the secret key are both set. */
  @IsOptional()
  @IsString()
  LANGFUSE_PUBLIC_KEY?: string;

  @ValidateIf((configs: Configs) => !!configs.LANGFUSE_PUBLIC_KEY)
  @IsString()
  @IsNotEmpty({ message: 'LANGFUSE_SECRET_KEY is required when LANGFUSE_PUBLIC_KEY is set' })
  LANGFUSE_SECRET_KEY?: string;

  /** The Langfuse server (`https://cloud.langfuse.com` when unset or empty). */
  @ValidateIf((configs: Configs) => !!configs.LANGFUSE_BASE_URL)
  @Matches(/^https?:\/\/[^\s]+$/, { message: 'LANGFUSE_BASE_URL must be an http(s) url' })
  LANGFUSE_BASE_URL?: string;

  /** Minimum level printed (`log` when unset); `debug` adds the SQL queries. */
  @IsOptional()
  @IsIn(LOG_LEVELS)
  LOG_LEVEL?: LogLevel;

  /** Proxies in front of the API (load balancer, ingress) whose `X-Forwarded-For` counts; 0 when unset. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  TRUST_PROXY_HOPS?: number;

  /** Sessions and the rate limits; with a password outside `ENV=local`. */
  @Validate(RedisUrlRule)
  REDIS_URL: string;

  /** The OAuth client id of the web app: the audience a Google ID token must be issued for. */
  @IsString()
  @IsNotEmpty()
  GOOGLE_CLIENT_ID: string;

  /** Signs the CSRF tokens; at least 32 random characters (`openssl rand -base64 48`). */
  @IsString()
  @MinLength(MIN_AUTH_SECRET_LENGTH)
  AUTH_SECRET: string;

  /**
   * Who may sign up with Google: an email here gets a user on its first sign-in. A user already in
   * the database may always sign in. Unset: no new users.
   */
  @ValidateIf(isSet('AUTH_ALLOWED_EMAILS'))
  @Matches(EMAIL_LIST, { message: 'AUTH_ALLOWED_EMAILS must be comma separated emails' })
  AUTH_ALLOWED_EMAILS?: string;

  /** The session cookie is Secure (`__Host-`) unless `false`; only `ENV=local` may turn it off. */
  @ValidateIf(isSet('AUTH_COOKIE_SECURE'))
  @Validate(CookieSecureRule)
  AUTH_COOKIE_SECURE?: string;

  /** `strict` when unset; `lax` / `none` only for a web app on another site (`none` needs Secure). */
  @ValidateIf(isSet('AUTH_COOKIE_SAME_SITE'))
  @IsIn(Object.values(CookieSameSite))
  AUTH_COOKIE_SAME_SITE?: CookieSameSite;
}
