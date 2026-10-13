import { Module } from '@nestjs/common';
import { NutritionGoalRepository } from './nutrition-goal.repository';

@Module({
  providers: [NutritionGoalRepository],
  exports: [NutritionGoalRepository],
})
export class NutritionGoalRepositoryModule {}
