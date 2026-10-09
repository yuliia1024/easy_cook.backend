import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from '../common/exceptions';
import { ApiConfigService } from '../configs/api-config/api-config.service';
import { createMock } from '../test/create-mock';
import { configureApp } from './configure-app';

describe('configureApp', () => {
  let app: jest.Mocked<INestApplication>;
  const cors = { origin: true, credentials: true };

  beforeEach(() => {
    app = createMock<INestApplication>();
    app.get.mockReturnValue(createMock<ApiConfigService>({ cors: () => cors }));
    configureApp(app);
  });

  it('serves everything under /api', () => {
    expect(app.setGlobalPrefix).toHaveBeenCalledWith('api');
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

  it('adds helmet, CORS from config and shutdown hooks', () => {
    expect(app.use).toHaveBeenCalledWith(expect.any(Function));
    expect(app.enableCors).toHaveBeenCalledWith(cors);
    expect(app.enableShutdownHooks).toHaveBeenCalled();
  });
});
