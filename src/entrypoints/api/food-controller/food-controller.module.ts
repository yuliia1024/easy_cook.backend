import { Module } from '@nestjs/common';
import { FoodItemModule } from '../../../modules/services/food-item/food-item.module';
import { FoodControllerService } from './food-controller.service';
import { FoodController } from './food.controller';

@Module({
  imports: [FoodItemModule],
  controllers: [FoodController],
  providers: [FoodControllerService],
})
export class FoodControllerModule {}
