import { Module } from '@nestjs/common';
import { RecipeSearchRepository } from './recipe-search.repository';

@Module({
  providers: [RecipeSearchRepository],
  exports: [RecipeSearchRepository],
})
export class RecipeSearchRepositoryModule {}
