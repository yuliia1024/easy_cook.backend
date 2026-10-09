import {
  IsBooleanString,
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';
import { Environments } from '../common/types';

/**
 * Every environment variable the application reads. Validated once on start-up by
 * `ConfigService`, so a missing secret fails the boot instead of the first request.
 */
export class Configs {
  @IsNumberString()
  PORT: string;

  @IsIn(Object.values(Environments))
  ENV: Environments;

  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsOptional()
  @IsBooleanString()
  SWAGGER_ENABLED?: string;

  @IsString()
  FRONT_END_URL: string;

  @IsString()
  POSTGRES_HOST: string;

  @IsNumberString()
  POSTGRES_PORT: string;

  @IsString()
  POSTGRES_USER: string;

  @IsString()
  POSTGRES_PASSWORD: string;

  @IsString()
  POSTGRES_DB: string;

  @IsOptional()
  @IsBooleanString()
  POSTGRES_LOGGING?: string;

  @IsString()
  REDIS_HOST: string;

  @IsNumberString()
  REDIS_PORT: string;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @IsOptional()
  @IsNumberString()
  REDIS_DB?: string;

  @IsNotEmpty()
  AUTH_JWT_SECRET: string;

  @IsNumberString()
  AUTH_JWT_EXPIRES_IN_SEC: string;

  @IsNotEmpty()
  AUTH_JWT_REFRESH_SECRET: string;

  @IsNumberString()
  AUTH_JWT_REFRESH_EXPIRES_IN_SEC: string;

  @IsNumberString()
  PASSWORD_HASH_SALT: string;

  @IsNumberString()
  OTP_LENGTH: string;

  @IsNumberString()
  OTP_TTL_IN_SEC: string;

  @IsNumberString()
  OTP_MAX_ATTEMPTS: string;

  @IsNumberString()
  OTP_RESEND_COOLDOWN_IN_SEC: string;

  @IsString()
  SMTP_HOST: string;

  @IsNumberString()
  SMTP_PORT: string;

  @IsOptional()
  @IsBooleanString()
  SMTP_SECURE?: string;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASSWORD?: string;

  @IsString()
  EMAIL_FROM_ADDRESS: string;
}
