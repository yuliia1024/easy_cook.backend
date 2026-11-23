import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from '../common/exceptions';
import { requestLoggingMiddleware } from '../common/logger';
import { ApiConfigService } from '../configs/api-config/api-config.service';
import { createMock } from '../test/create-mock';
import { configureApp, noStoreMiddleware } from './configure-app';

describe('configureApp', () => {
  let app: jest.Mocked<INestApplication>;
  const cors = { origin: true, credentials: true };
  const express = { set: jest.fn() };

  beforeEach(() => {
    app = createMock<INestApplication>();
    app.get.mockReturnValue(createMock<ApiConfigService>({ cors: () => cors, trustProxyHops: 1 }));
    app.getHttpAdapter.mockReturnValue({ getInstance: () => express } as never);
    configureApp(app);
  });

  it('trusts the configured proxies for the client ip', () => {
    expect(express.set).toHaveBeenCalledWith('trust proxy', 1);
  });

  it('marks every response no-store', () => {
    const res = { setHeader: jest.fn() };
    const next = jest.fn();

    noStoreMiddleware({} as never, res as never, next);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(next).toHaveBeenCalled();
    expect(app.use).toHaveBeenCalledWith(noStoreMiddleware);
  });

  it('serves everything under /api', () => {
    expect(app.setGlobalPrefix).toHaveBeenCalledWith('api');
  });

  it('installs the request logging middleware before anything else', () => {
    expect(app.use.mock.calls[0][0]).toBe(requestLoggingMiddleware);
  });

  it('installs the exception filter', () => {
    expect(app.useGlobalFilters).toHaveBeenCalledWith(expect.any(AllExceptionsFilter));
  });

  it('validates and strips unknown fields', () => {
    const pipe = app.useGlobalPipes.mock.calls[0][0] as ValidationPipe;
    const options = (pipe as unknown as { validatorOptions: Record<string, boolean> })
      .validatorOptions;

    expect(pipe).toBeInstanceOf(ValidationPipe);
    expect(options).toMatchObject({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
  });

  it('adds helmet, cookies, CORS from config and shutdown hooks', () => {
    expect(app.use).toHaveBeenCalledTimes(4);
    expect(app.use).toHaveBeenCalledWith(expect.any(Function));
    expect(app.enableCors).toHaveBeenCalledWith(cors);
    expect(app.enableShutdownHooks).toHaveBeenCalled();
  });
});
