import { Module } from '@nestjs/common';
import { FoodItemRepository } from './food-item.repository';

@Module({
  providers: [FoodItemRepository],
  exports: [FoodItemRepository],
})
export class FoodItemRepositoryModule {}
