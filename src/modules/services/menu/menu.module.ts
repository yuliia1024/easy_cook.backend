import { Module } from '@nestjs/common';
import { MenuRepositoryModule } from '../../data-access/menu/menu.repository.module';
import { AssistantModule } from '../assistant/assistant.module';
import { DietaryPreferenceModule } from '../dietary-preference/dietary-preference.module';
import { NutritionGoalModule } from '../nutrition-goal/nutrition-goal.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { RecipeModule } from '../recipe/recipe.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { MenuComposer } from './menu-composer';
import { MenuPlanner } from './menu-planner';
import { MenuService } from './menu.service';

@Module({
  imports: [
    MenuRepositoryModule,
    UserProfileModule,
    NutritionGoalModule,
    DietaryPreferenceModule,
    RecipeModule,
    NutritionModule,
    AssistantModule,
  ],
  providers: [MenuService, MenuComposer, MenuPlanner],
  exports: [MenuService, MenuComposer],
})
export class MenuModule {}
