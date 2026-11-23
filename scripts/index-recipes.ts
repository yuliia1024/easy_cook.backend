/**
 * Brings the recipe search index up to date: the documents (full-text) and the vectors of every
 * model of EMBEDDING_PROVIDERS (the local Ollama, then OpenAI). Incremental: only new or changed
 * recipes are embedded, so it is safe to run after every seed, import or deploy. A model whose
 * provider is down is skipped; with none up the documents are still written and full-text search
 * works (exit code 0, the models are reported as skipped).
 *
 *   npm run search:index             # sync what changed
 *   npm run search:index -- --force  # rebuild and re-embed everything (new document version)
 *   npm run search:index -- --status # the state of every index, changes nothing
 *   npm run search:index -- --prune  # also drop the vectors of models no longer configured
 */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '../src/configs/config.module';
import { RecipeIndexService } from '../src/modules/services/recipe-search/recipe-index.service';
import { RecipeSearchModule } from '../src/modules/services/recipe-search/recipe-search.module';
import { PrismaModule } from '../src/providers/prisma/prisma.module';
import { parseIndexArgs } from './lib/index-args';

@Module({ imports: [ConfigModule, PrismaModule, RecipeSearchModule] })
class RecipeIndexCliModule {}

async function main(): Promise<void> {
  const args = parseIndexArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(RecipeIndexCliModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const index = app.get(RecipeIndexService);
    if (!args.status) {
      const result = await index.sync({
        force: args.force,
        onProgress: (model, done, total) => console.log(`${model}: ${done}/${total}`),
      });
      console.log(
        `Recipes: ${result.recipes}, documents written: ${result.documentsWritten}, ${result.durationMs} ms`,
      );
      for (const { model, embedded, tokens, error } of result.models) {
        console.log(
          `  ${model}: ${error ? `skipped (${error})` : `${embedded} embedded, ${tokens} tokens`}`,
        );
      }
      if (args.prune) {
        console.log(`Pruned ${await index.pruneOtherModels()} vectors of other models`);
      }
    }
    for (const { model, recipes, embedded, complete } of await index.status()) {
      console.log(`${model}: ${embedded}/${recipes} embedded${complete ? '' : ' - INCOMPLETE'}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
