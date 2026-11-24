import { Injectable, LogLevel } from '@nestjs/common';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '../config.service';
import { CSRF_HEADER, DEFAULT_LOG_LEVEL, LOG_LEVELS, RateLimitName } from '../../common/constants';
import { REQUEST_ID_HEADER } from '../../common/logger';
import { Environments } from '../../common/types';

/** What `CORS_ORIGINS=*` (`ENV=local` only) allows: the browser of the developer. */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
/** The `Retry-After` of a 429, one per limit (`ThrottlerGuard`: no suffix for the default one). */
const RETRY_AFTER_HEADERS = Object.values(RateLimitName).map((name) =>
  name === RateLimitName.Default ? 'retry-after' : `retry-after-${name}`,
);
/** How long a browser may cache a CORS preflight. */
const CORS_MAX_AGE_SECONDS = 600;

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

  /** Proxies in front of the API whose `X-Forwarded-For` is trusted (0: none, the socket address). */
  public get trustProxyHops(): number {
    return this.configService.getNumber('TRUST_PROXY_HOPS') || 0;
  }

  /**
   * The web app origins of `CORS_ORIGINS`. `*` (or unset, never on production) is not "any origin":
   * the session cookie goes with every request, so only local origins pass.
   */
  public isOriginAllowed(origin: string): boolean {
    const origins = this.configService.get('CORS_ORIGINS') || '*';
    if (origins === '*') {
      return LOCAL_ORIGIN.test(origin);
    }
    return origins.split(',').some((allowed) => allowed.trim() === origin);
  }

  /** Credentials (the session cookie) only for the allowed origins (`isOriginAllowed`). */
  public cors(): CorsOptions {
    return {
      origin: (origin, callback) => callback(null, !origin || this.isOriginAllowed(origin)),
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['content-type', CSRF_HEADER, REQUEST_ID_HEADER],
      // Lets the web app read the id to quote it in a bug report, and when a rate limit lets it retry.
      exposedHeaders: [REQUEST_ID_HEADER, ...RETRY_AFTER_HEADERS],
      maxAge: CORS_MAX_AGE_SECONDS,
    };
  }
}
