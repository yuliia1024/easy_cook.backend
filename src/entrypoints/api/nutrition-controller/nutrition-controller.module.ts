import { Module } from '@nestjs/common';
import { NutritionGoalModule } from '../../../modules/services/nutrition-goal/nutrition-goal.module';
import { NutritionControllerService } from './nutrition-controller.service';
import { NutritionController } from './nutrition.controller';

@Module({
  imports: [NutritionGoalModule],
  controllers: [NutritionController],
  providers: [NutritionControllerService],
})
export class NutritionControllerModule {}
