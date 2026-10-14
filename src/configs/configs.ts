import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { LogLevel } from '@nestjs/common';
import { LOG_LEVELS } from '../common/constants';
import { Environments } from '../common/types';

/** `https://a.com, http://localhost:5173`: comma separated http(s) origins. */
const ORIGIN_LIST = /^https?:\/\/[^\s,]+(\s*,\s*https?:\/\/[^\s,]+)*$/;

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

  /** Minimum level printed (`log` when unset); `debug` adds the SQL queries. */
  @IsOptional()
  @IsIn(LOG_LEVELS)
  LOG_LEVEL?: LogLevel;
}
