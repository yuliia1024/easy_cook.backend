import { Module } from '@nestjs/common';
import { RecipeRepositoryModule } from '../../data-access/recipe/recipe.repository.module';
import { RecipeService } from './recipe.service';

@Module({
  imports: [RecipeRepositoryModule],
  providers: [RecipeService],
  exports: [RecipeService],
})
export class RecipeModule {}
