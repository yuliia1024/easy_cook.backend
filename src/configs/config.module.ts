import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service';
import { ApiConfigService } from './api-config/api-config.service';
import { DatabaseConfigService } from './database-config/database-config.service';
import { RedisConfigService } from './redis-config/redis-config.service';
import { AuthJwtConfigService } from './auth-jwt-config/auth-jwt-config.service';
import { OtpConfigService } from './otp-config/otp-config.service';
import { MailConfigService } from './mail-config/mail-config.service';
import { PasswordConfigService } from './password-config/password-config.service';

const configServices = [
  ConfigService,
  ApiConfigService,
  DatabaseConfigService,
  RedisConfigService,
  AuthJwtConfigService,
  OtpConfigService,
  MailConfigService,
  PasswordConfigService,
];

@Global()
@Module({
  providers: configServices,
  exports: configServices,
})
export class ConfigModule {}
