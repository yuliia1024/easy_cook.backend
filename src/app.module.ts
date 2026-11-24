import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './configs/config.module';
import { AuthGuard } from './entrypoints/api/auth/auth.guard';
import { RequestOriginGuard } from './entrypoints/api/auth/request-origin.guard';
import { SessionGuard } from './entrypoints/api/auth/session.guard';
import { AuthControllerModule } from './entrypoints/api/auth-controller/auth-controller.module';
import { ConversationControllerModule } from './entrypoints/api/conversation-controller/conversation-controller.module';
import { FoodControllerModule } from './entrypoints/api/food-controller/food-controller.module';
import { HealthController } from './entrypoints/api/health.controller';
import { MenuControllerModule } from './entrypoints/api/menu-controller/menu-controller.module';
import { NutritionControllerModule } from './entrypoints/api/nutrition-controller/nutrition-controller.module';
import { PreferenceControllerModule } from './entrypoints/api/preference-controller/preference-controller.module';
import { ProfileControllerModule } from './entrypoints/api/profile-controller/profile-controller.module';
import { RateLimitGuard } from './entrypoints/api/rate-limit/rate-limit.guard';
import { rateLimitOptions } from './entrypoints/api/rate-limit/rate-limit.options';
import { RecipeControllerModule } from './entrypoints/api/recipe-controller/recipe-controller.module';
import { AuthModule } from './modules/services/auth/auth.module';
import { LlmModule } from './providers/llm/llm.module';
import { PrismaModule } from './providers/prisma/prisma.module';
import { RedisThrottlerStorage } from './providers/redis/redis-throttler.storage';
import { RedisModule } from './providers/redis/redis.module';
import { TracingModule } from './providers/tracing/tracing.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    LlmModule,
    TracingModule,
    AuthModule,
    // Limits of every route, counted in Redis (`RATE_LIMITS`).
    ThrottlerModule.forRootAsync({
      inject: [RedisThrottlerStorage],
      useFactory: rateLimitOptions,
    }),
    AuthControllerModule,
    ProfileControllerModule,
    NutritionControllerModule,
    PreferenceControllerModule,
    FoodControllerModule,
    RecipeControllerModule,
    MenuControllerModule,
    ConversationControllerModule,
  ],
  controllers: [HealthController],
  // In this order: cross-site requests out, the session read, the rate limits (by email once signed
  // in), then the session and its CSRF token required.
  providers: [
    { provide: APP_GUARD, useClass: RequestOriginGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
