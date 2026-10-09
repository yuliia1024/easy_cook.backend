import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './bootstrap';
import { ApiConfigService } from './configs/api-config/api-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const apiConfigService = app.get(ApiConfigService);

  configureApp(app);

  if (apiConfigService.isSwaggerEnabled) {
    setupSwagger(app);
  }

  await app.listen(apiConfigService.port);

  Logger.log(`API started on port ${apiConfigService.port} (${apiConfigService.env})`, 'Bootstrap');
}

bootstrap();
