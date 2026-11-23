import { Module } from '@nestjs/common';
import { RecipeSearchRepositoryModule } from '../../data-access/recipe-search/recipe-search.repository.module';
import { RecipeRepositoryModule } from '../../data-access/recipe/recipe.repository.module';
import { EmbeddingModule } from '../../../providers/embedding/embedding.module';
import { RecipeIndexService } from './recipe-index.service';
import { RecipeSearchService } from './recipe-search.service';

@Module({
  imports: [RecipeSearchRepositoryModule, RecipeRepositoryModule, EmbeddingModule],
  providers: [RecipeIndexService, RecipeSearchService],
  exports: [RecipeIndexService, RecipeSearchService],
})
export class RecipeSearchModule {}
