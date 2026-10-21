import { Module } from '@nestjs/common';
import { DietaryPreferenceRepositoryModule } from '../../data-access/dietary-preference/dietary-preference.repository.module';
import { NutritionGoalRepositoryModule } from '../../data-access/nutrition-goal/nutrition-goal.repository.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { ProfileContextService } from './profile-context.service';

@Module({
  imports: [UserProfileModule, NutritionGoalRepositoryModule, DietaryPreferenceRepositoryModule],
  providers: [ProfileContextService],
  exports: [ProfileContextService],
})
export class ProfileContextModule {}
