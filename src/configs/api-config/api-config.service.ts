import { Injectable, LogLevel } from '@nestjs/common';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '../config.service';
import { DEFAULT_LOG_LEVEL, LOG_LEVELS } from '../../common/constants';
import { REQUEST_ID_HEADER } from '../../common/logger';
import { Environments } from '../../common/types';

@Injectable()
export class ApiConfigService {
  constructor(private readonly configService: ConfigService) {}

  public get port(): number {
    return this.configService.getNumber('PORT');
  }

  public get env(): Environments {
    return this.configService.get('ENV');
  }

  public get isSwaggerEnabled(): boolean {
    return this.configService.getBoolean('SWAGGER_ENABLED') && this.env !== Environments.PRODUCTION;
  }

  /** `LOG_LEVEL` and every more severe level. */
  public get logLevels(): LogLevel[] {
    const level = this.configService.get('LOG_LEVEL') || DEFAULT_LOG_LEVEL;
    return LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(level) + 1);
  }

  public cors(): CorsOptions {
    const origins = this.configService.get('CORS_ORIGINS') || '*';

    return {
      origin: origins === '*' ? true : origins.split(',').map((o) => o.trim()),
      credentials: true,
      // Lets the web app read the id to quote it in a bug report.
      exposedHeaders: [REQUEST_ID_HEADER],
    };
  }
}
