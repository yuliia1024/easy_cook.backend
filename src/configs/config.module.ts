import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service';
import { ApiConfigService } from './api-config/api-config.service';
import { AuthConfigService } from './auth-config/auth-config.service';
import { DatabaseConfigService } from './database-config/database-config.service';
import { EmbeddingConfigService } from './embedding-config/embedding-config.service';
import { ModelProvidersConfigService } from './model-providers-config/model-providers-config.service';
import { RedisConfigService } from './redis-config/redis-config.service';
import { TracingConfigService } from './tracing-config/tracing-config.service';

const configServices = [
  ConfigService,
  ApiConfigService,
  DatabaseConfigService,
  ModelProvidersConfigService,
  EmbeddingConfigService,
  RedisConfigService,
  AuthConfigService,
  TracingConfigService,
];

@Global()
@Module({
  providers: configServices,
  exports: configServices,
})
export class ConfigModule {}
