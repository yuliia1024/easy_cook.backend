import { Module } from '@nestjs/common';
import { MenuRepositoryModule } from '../../data-access/menu/menu.repository.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { ProfileContextModule } from '../profile-context/profile-context.module';
import { RecipeModule } from '../recipe/recipe.module';
import { RecipeSearchModule } from '../recipe-search/recipe-search.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { MenuComposer } from './menu-composer';
import { MenuPlannerService } from './menu-planner.service';
import { MenuService } from './menu.service';

@Module({
  imports: [
    MenuRepositoryModule,
    UserProfileModule,
    ProfileContextModule,
    RecipeModule,
    RecipeSearchModule,
    NutritionModule,
  ],
  providers: [MenuService, MenuComposer, MenuPlannerService],
  exports: [MenuService, MenuPlannerService],
})
export class MenuModule {}
