import { Module } from '@nestjs/common';
import { RecipeIngredientRepository } from './recipe-ingredient.repository';

@Module({
  providers: [RecipeIngredientRepository],
  exports: [RecipeIngredientRepository],
})
export class RecipeIngredientRepositoryModule {}
