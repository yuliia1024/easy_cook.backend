import { Module } from '@nestjs/common';
import { MenuRepositoryModule } from '../../data-access/menu/menu.repository.module';
import { DietaryPreferenceModule } from '../dietary-preference/dietary-preference.module';
import { NutritionGoalModule } from '../nutrition-goal/nutrition-goal.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { MenuComposer } from './menu-composer';
import { MenuPlannerService } from './menu-planner.service';
import { MenuService } from './menu.service';

@Module({
  imports: [MenuRepositoryModule, UserProfileModule, NutritionGoalModule, DietaryPreferenceModule],
  providers: [MenuService, MenuComposer, MenuPlannerService],
  exports: [MenuService, MenuPlannerService],
})
export class MenuModule {}
