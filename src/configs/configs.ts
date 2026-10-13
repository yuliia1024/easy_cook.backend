import {
  IsBooleanString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { Environments } from '../common/types';

/**
 * Every environment variable the application reads. Validated once on start-up by
 * `ConfigService`, so a missing value fails the boot instead of the first request.
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

  /** Also read by the Prisma CLI (migrations, seed). */
  @Matches(/^postgres(ql)?:\/\//, { message: 'DATABASE_URL must be a postgres connection url' })
  DATABASE_URL: string;

  @IsOptional()
  @IsBooleanString()
  POSTGRES_LOGGING?: string;
}
