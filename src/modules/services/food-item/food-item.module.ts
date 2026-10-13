import { Module } from '@nestjs/common';
import { FoodItemRepositoryModule } from '../../data-access/food-item/food-item.repository.module';
import { FoodItemService } from './food-item.service';

@Module({
  imports: [FoodItemRepositoryModule],
  providers: [FoodItemService],
  exports: [FoodItemService],
})
export class FoodItemModule {}
