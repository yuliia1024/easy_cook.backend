import { Injectable, Logger } from '@nestjs/common';
import { EMBEDDING_BATCH_SIZE } from '../../../common/constants';
import { EmbeddingUnavailableException } from '../../../common/exceptions';
import { EmbeddingService } from '../../../providers/embedding/embedding.service';
import {
  IndexStatus,
  RecipeSearchRepository,
} from '../../data-access/recipe-search/recipe-search.repository';
import { RecipeRepository } from '../../data-access/recipe/recipe.repository';
import { buildRecipeDocument, RecipeDocument } from './recipe-document';

/** Documents written to the database at once. */
const DOCUMENT_WRITE_BATCH = 500;

export interface IndexSyncOptions {
  /** Rebuild and re-embed every recipe, changed or not. */
  force?: boolean;
  /** After every embedded batch. */
  onProgress?: (model: string, embedded: number, total: number) => void;
}

export interface ModelIndexResult {
  model: string;
  /** Recipes embedded by this run. */
  embedded: number;
  tokens: number;
  /** Why the model was skipped (its provider is down); the batches before it are saved. */
  error: string | null;
}

export interface IndexSyncResult {
  recipes: number;
  /** Documents whose content changed (or were missing) and were written. */
  documentsWritten: number;
  /** One per model of `EMBEDDING_PROVIDERS`, in order. */
  models: ModelIndexResult[];
  durationMs: number;
}

export interface RecipeIndexStatus extends IndexStatus {
  model: string;
  /** Every recipe is embedded from its current document. */
  complete: boolean;
}

const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );

/**
 * Keeps the search tables in step with the recipes, for every model of `EMBEDDING_PROVIDERS`: a
 * query embedded by the fallback model is searched among that model's vectors, so each needs its
 * own vectors (one HNSW index serves them all). Incremental and idempotent: a document is written when its content hash changed, a
 * recipe is embedded when its vector by the model is missing or of another hash; every batch is
 * saved as it comes, so a failed run resumes. A model whose provider is down is skipped; with
 * every one down the documents are still written (full-text search works) and a warning logged.
 */
@Injectable()
export class RecipeIndexService {
  private readonly logger = new Logger(RecipeIndexService.name);

  constructor(
    private readonly recipeRepository: RecipeRepository,
    private readonly searchRepository: RecipeSearchRepository,
    private readonly embeddingService: EmbeddingService,
  ) {}

  /** A model whose provider is down is reported with its `error`; the documents are written anyway. */
  public async sync({
    force = false,
    onProgress,
  }: IndexSyncOptions = {}): Promise<IndexSyncResult> {
    const startedAt = Date.now();
    const recipes = await this.recipeRepository.findAll({});
    const documents = recipes.map(buildRecipeDocument);

    const models: ModelIndexResult[] = [];
    let documentsWritten = 0;
    for (const [index, model] of this.embeddingService.modelKeys.entries()) {
      const state = new Map(
        (await this.searchRepository.findIndexState(model)).map((row) => [row.recipeId, row]),
      );
      if (index === 0) {
        const changed = documents.filter(
          (doc) => force || state.get(doc.recipeId)?.documentHash !== doc.contentHash,
        );
        for (const batch of chunk(changed, DOCUMENT_WRITE_BATCH)) {
          await this.searchRepository.upsertDocuments(batch);
        }
        documentsWritten = changed.length;
      }
      const toEmbed = documents.filter(
        (doc) => force || state.get(doc.recipeId)?.embeddingHash !== doc.contentHash,
      );
      models.push(await this.embedAll(model, toEmbed, onProgress));
    }

    const result: IndexSyncResult = {
      recipes: recipes.length,
      documentsWritten,
      models,
      durationMs: Date.now() - startedAt,
    };
    this.logger.log(
      `index synced recipes=${result.recipes} documents=${documentsWritten} ${models
        .map(({ model, embedded, error }) => `${model}=${error ? 'skipped' : embedded}`)
        .join(' ')} ms=${result.durationMs}`,
    );
    if (models.every(({ error }) => error !== null)) {
      // The documents are written: the search runs on full text until a model is back.
      this.logger.warn('no embedding model could be indexed; recipe search runs on full text');
    }
    return result;
  }

  /** Of every model of `EMBEDDING_PROVIDERS`, in order. */
  public async status(): Promise<RecipeIndexStatus[]> {
    return Promise.all(
      this.embeddingService.modelKeys.map(async (model) => {
        const status = await this.searchRepository.getIndexStatus(model);
        return { model, ...status, complete: status.embedded === status.recipes };
      }),
    );
  }

  /** Drops the vectors of the models no longer in `EMBEDDING_PROVIDERS`; returns how many. */
  public async pruneOtherModels(): Promise<number> {
    return this.searchRepository.deleteEmbeddingsExcept(this.embeddingService.modelKeys);
  }

  private async embedAll(
    model: string,
    documents: RecipeDocument[],
    onProgress: IndexSyncOptions['onProgress'],
  ): Promise<ModelIndexResult> {
    const result: ModelIndexResult = { model, embedded: 0, tokens: 0, error: null };
    for (const batch of chunk(documents, EMBEDDING_BATCH_SIZE)) {
      try {
        result.tokens += await this.embedBatch(model, batch);
      } catch (error) {
        if (!(error instanceof EmbeddingUnavailableException)) {
          throw error;
        }
        this.logger.warn(`index of ${model} skipped: its provider is unavailable`);
        return { ...result, error: error.message };
      }
      result.embedded += batch.length;
      onProgress?.(model, result.embedded, documents.length);
    }
    return result;
  }

  private async embedBatch(model: string, documents: RecipeDocument[]): Promise<number> {
    const { embeddings, tokens } = await this.embeddingService.embedDocuments(
      model,
      documents.map(({ content }) => content),
    );
    await this.searchRepository.upsertEmbeddings(
      model,
      documents.map(({ recipeId, contentHash }, i) => ({
        recipeId,
        contentHash,
        embedding: embeddings[i],
      })),
    );
    return tokens;
  }
}
