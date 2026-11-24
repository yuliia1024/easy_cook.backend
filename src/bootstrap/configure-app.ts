import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AllExceptionsFilter } from '../common/exceptions';
import { requestLoggingMiddleware } from '../common/logger';
import { ApiConfigService } from '../configs/api-config/api-config.service';

/** API responses hold the data of a user: never kept by a browser or a shared cache. */
export function noStoreMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/** Request pipeline shared by `main.ts` and the e2e tests. */
export function configureApp(app: INestApplication): void {
  const apiConfigService = app.get(ApiConfigService);

  // First, so the request id covers every other middleware, the pipes and the filter.
  app.use(requestLoggingMiddleware);
  // `req.ip` (the rate limits) is the client behind that many trusted proxies, not the proxy.
  app.getHttpAdapter().getInstance().set('trust proxy', apiConfigService.trustProxyHops);
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
    }),
  );
  app.use(helmet({ referrerPolicy: { policy: 'no-referrer' } }));
  app.use(noStoreMiddleware);
  // Unsigned: the session token is random and looked up in Redis, nothing to tamper with.
  app.use(cookieParser());
  app.enableCors(apiConfigService.cors());
  app.enableShutdownHooks();
}
