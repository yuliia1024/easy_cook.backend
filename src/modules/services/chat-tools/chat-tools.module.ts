import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module';
import { FoodItemModule } from '../food-item/food-item.module';
import { MenuModule } from '../menu/menu.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { PreferenceChangeModule } from '../preference-change/preference-change.module';
import { RecipeModule } from '../recipe/recipe.module';
import { ChatToolsService } from './chat-tools.service';

@Module({
  imports: [
    RecipeModule,
    FoodItemModule,
    NutritionModule,
    ConversationModule,
    MenuModule,
    PreferenceChangeModule,
  ],
  providers: [ChatToolsService],
  exports: [ChatToolsService],
})
export class ChatToolsModule {}
