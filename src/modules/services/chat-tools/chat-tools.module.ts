import { Module } from '@nestjs/common';
import { FoodItemModule } from '../food-item/food-item.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { RecipeModule } from '../recipe/recipe.module';
import { ChatToolsService } from './chat-tools.service';

@Module({
  imports: [RecipeModule, FoodItemModule, NutritionModule],
  providers: [ChatToolsService],
  exports: [ChatToolsService],
})
export class ChatToolsModule {}
