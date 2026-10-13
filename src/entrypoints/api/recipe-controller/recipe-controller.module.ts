import { Module } from '@nestjs/common';
import { NutritionModule } from '../../../modules/services/nutrition/nutrition.module';
import { RecipeModule } from '../../../modules/services/recipe/recipe.module';
import { RecipeControllerService } from './recipe-controller.service';
import { RecipeController } from './recipe.controller';

@Module({
  imports: [RecipeModule, NutritionModule],
  controllers: [RecipeController],
  providers: [RecipeControllerService],
})
export class RecipeControllerModule {}
