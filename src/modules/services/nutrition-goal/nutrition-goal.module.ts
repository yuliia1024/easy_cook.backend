import { Module } from '@nestjs/common';
import { NutritionGoalRepositoryModule } from '../../data-access/nutrition-goal/nutrition-goal.repository.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { NutritionGoalService } from './nutrition-goal.service';

@Module({
  imports: [NutritionGoalRepositoryModule, UserProfileModule],
  providers: [NutritionGoalService],
  exports: [NutritionGoalService],
})
export class NutritionGoalModule {}
