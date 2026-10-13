import { Module } from '@nestjs/common';
import { RecipeIngredientRepositoryModule } from '../../data-access/recipe-ingredient/recipe-ingredient.repository.module';
import { RecipeRepositoryModule } from '../../data-access/recipe/recipe.repository.module';
import { FoodItemModule } from '../food-item/food-item.module';
import { RecipeService } from './recipe.service';

@Module({
  imports: [RecipeRepositoryModule, RecipeIngredientRepositoryModule, FoodItemModule],
  providers: [RecipeService],
  exports: [RecipeService],
})
export class RecipeModule {}
