import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './configs/config.module';
import { ConversationControllerModule } from './entrypoints/api/conversation-controller/conversation-controller.module';
import { FoodControllerModule } from './entrypoints/api/food-controller/food-controller.module';
import { HealthController } from './entrypoints/api/health.controller';
import { MenuControllerModule } from './entrypoints/api/menu-controller/menu-controller.module';
import { NutritionControllerModule } from './entrypoints/api/nutrition-controller/nutrition-controller.module';
import { PreferenceControllerModule } from './entrypoints/api/preference-controller/preference-controller.module';
import { ProfileControllerModule } from './entrypoints/api/profile-controller/profile-controller.module';
import { RecipeControllerModule } from './entrypoints/api/recipe-controller/recipe-controller.module';
import { PrismaModule } from './providers/prisma/prisma.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    // Default limit for every route.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    ProfileControllerModule,
    NutritionControllerModule,
    PreferenceControllerModule,
    FoodControllerModule,
    RecipeControllerModule,
    MenuControllerModule,
    ConversationControllerModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
