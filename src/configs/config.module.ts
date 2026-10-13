import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service';
import { ApiConfigService } from './api-config/api-config.service';
import { DatabaseConfigService } from './database-config/database-config.service';

const configServices = [ConfigService, ApiConfigService, DatabaseConfigService];

@Global()
@Module({
  providers: configServices,
  exports: configServices,
})
export class ConfigModule {}
