import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AllExceptionsFilter } from '../common/exceptions';
import { ApiConfigService } from '../configs/api-config/api-config.service';

/** Request pipeline shared by `main.ts` and the e2e tests. */
export function configureApp(app: INestApplication): void {
  const apiConfigService = app.get(ApiConfigService);

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
  app.use(helmet());
  app.enableCors(apiConfigService.cors());
  app.enableShutdownHooks();
}
