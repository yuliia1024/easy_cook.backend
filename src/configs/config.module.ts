import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service';
import { ApiConfigService } from './api-config/api-config.service';
import { DatabaseConfigService } from './database-config/database-config.service';
import { OpenAiConfigService } from './open-ai-config/open-ai-config.service';

const configServices = [
  ConfigService,
  ApiConfigService,
  DatabaseConfigService,
  OpenAiConfigService,
];

@Global()
@Module({
  providers: configServices,
  exports: configServices,
})
export class ConfigModule {}
