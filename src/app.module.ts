import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from './configs/config.module';
import { DatabaseConfigService } from './configs/database-config/database-config.service';
import { AuthControllerModule } from './entrypoints/api/auth-controller/auth-controller.module';
import { HealthController } from './entrypoints/api/health.controller';
import { UserControllerModule } from './entrypoints/api/user-controller/user-controller.module';
import { RedisModule } from './providers/redis/redis.module';

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    TypeOrmModule.forRootAsync({
      inject: [DatabaseConfigService],
      useFactory: (configService: DatabaseConfigService) => configService.config(),
    }),
    // Default limit for every route; the auth controller sets a stricter one.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    AuthControllerModule,
    UserControllerModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
