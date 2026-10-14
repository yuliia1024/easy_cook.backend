import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppLogger } from './common/logger';
import { Environments } from './common/types';
import { configureApp, setupSwagger } from './bootstrap';
import { ApiConfigService } from './configs/api-config/api-config.service';

async function bootstrap(): Promise<void> {
  // Start-up logs are held until the app logger (which needs the config) is set.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const apiConfigService = app.get(ApiConfigService);

  app.useLogger(
    new AppLogger({
      json: apiConfigService.env === Environments.PRODUCTION,
      logLevels: apiConfigService.logLevels,
    }),
  );

  configureApp(app);

  if (apiConfigService.isSwaggerEnabled) {
    setupSwagger(app);
  }

  await app.listen(apiConfigService.port);

  Logger.log(`API started on port ${apiConfigService.port} (${apiConfigService.env})`, 'Bootstrap');
}

bootstrap();
