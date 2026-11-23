import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service';
import { ApiConfigService } from './api-config/api-config.service';
import { DatabaseConfigService } from './database-config/database-config.service';
import { EmbeddingConfigService } from './embedding-config/embedding-config.service';
import { ModelProvidersConfigService } from './model-providers-config/model-providers-config.service';

const configServices = [
  ConfigService,
  ApiConfigService,
  DatabaseConfigService,
  ModelProvidersConfigService,
  EmbeddingConfigService,
];

@Global()
@Module({
  providers: configServices,
  exports: configServices,
})
export class ConfigModule {}
