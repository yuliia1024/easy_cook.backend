import { Injectable, Logger } from '@nestjs/common';
import {
  RECIPE_SEARCH_CANDIDATES,
  RECIPE_SEARCH_DEFAULT_LIMIT,
  RECIPE_SEARCH_MAX_LIMIT,
  RECIPE_SEARCH_MIN_WORD_LENGTH,
  RECIPE_SEARCH_QUERY_MAX_LENGTH,
  RECIPE_SEARCH_WEIGHTS,
  RecipeSearchMode,
} from '../../../common/constants';
import { EmbeddingUnavailableException } from '../../../common/exceptions';
import { embeddingModelKey } from '../../../common/utils';
import {
  RecipeSearchFilters,
  RecipeSearchQuery,
  RecipeSearchRow,
  RecipeSearchTimings,
} from '../../../common/types';
import { EmbeddingService, QueryEmbedding } from '../../../providers/embedding/embedding.service';
import { RecipeSearchRepository } from '../../data-access/recipe-search/recipe-search.repository';
import {
  RecipeRepository,
  RecipeWithIngredients,
} from '../../data-access/recipe/recipe.repository';

export interface RecipeSearchHit extends Omit<RecipeSearchRow, 'recipeId'> {
  recipe: RecipeWithIngredients;
  /**
   * The recipe is what the query asks for, not only near it: it has every word of the query, or
   * its similarity reaches the `matchSimilarity` of the model (any for a model not calibrated).
   * Full-text alone matches by the words only.
   */
  match: boolean;
}

/** The query as every search of `searchEach` shares it: embedded once. */
interface PreparedQuery {
  text: string;
  limit: number;
  mode: RecipeSearchMode;
  degraded: boolean;
  embedding: QueryEmbedding | null;
  startedAt: number;
  embeddingMs: number;
}

export interface RecipeSearchResult {
  hits: RecipeSearchHit[];
  /** The mode that ran: `lexical` when a hybrid search lost its embedding (`degraded`). */
  mode: RecipeSearchMode;
  /** True when every embedding provider failed and a hybrid search fell back to full-text. */
  degraded: boolean;
  /** `embeddingModelKey` of the vectors searched (the fallback's when the local model is down); null for full-text. */
  model: string | null;
  /**
   * Whether the search found what the query asks for, not only the nearest recipes: a hit is a
   * `match`. False when "sushi" finds only a poke bowl; the hits are then only similar.
   */
  matched: boolean;
  timings: RecipeSearchTimings;
}

const clampLimit = (limit: number | undefined): number =>
  Math.min(Math.max(Math.trunc(limit ?? RECIPE_SEARCH_DEFAULT_LIMIT), 1), RECIPE_SEARCH_MAX_LIMIT);

/**
 * The words of the query the full-text leg searches: those of `RECIPE_SEARCH_MIN_WORD_LENGTH`
 * letters or more ("лосось на вечерю" -> "лосось вечерю"); null when none is left. Pure.
 */
export function fullTextQuery(text: string): string | null {
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (word) => [...word].length >= RECIPE_SEARCH_MIN_WORD_LENGTH,
  );
  return words.length > 0 ? words.join(' ') : null;
}

/**
 * Recipes for a request in natural language, in any language: the query is embedded and matched
 * against the recipe vectors and, in the same SQL, full-text searched; the structured filters
 * (meal, diet, allergens, time) apply to both legs before ranking. Returns ranked recipes only -
 * no LLM here, the caller decides what the model sees. Logs counts and timings, never the text.
 */
@Injectable()
export class RecipeSearchService {
  private readonly logger = new Logger(RecipeSearchService.name);

  constructor(
    private readonly searchRepository: RecipeSearchRepository,
    private readonly recipeRepository: RecipeRepository,
    private readonly embeddingService: EmbeddingService,
  ) {}

  public async search(
    query: RecipeSearchQuery,
    abortSignal?: AbortSignal,
  ): Promise<RecipeSearchResult> {
    const [result] = await this.searchEach(query, [query.filters ?? {}], abortSignal);
    return result;
  }

  /**
   * The query searched once for every set of `filters` (the planner: one per meal), the query
   * embedded once for all of them. A client gone away (`abortSignal`) is not an embedding outage:
   * the search fails instead of falling back to full-text.
   */
  public async searchEach(
    query: Omit<RecipeSearchQuery, 'filters'>,
    filters: RecipeSearchFilters[],
    abortSignal?: AbortSignal,
  ): Promise<RecipeSearchResult[]> {
    const startedAt = performance.now();
    const text = query.text.trim().slice(0, RECIPE_SEARCH_QUERY_MAX_LENGTH);
    const limit = clampLimit(query.limit);
    let mode = query.mode ?? RecipeSearchMode.Hybrid;
    let degraded = false;
    if (text === '') {
      return filters.map((each) => this.result([], mode, false, null, startedAt, 0, 0, each));
    }

    let embedding: QueryEmbedding | null = null;
    const embeddingStartedAt = performance.now();
    if (mode !== RecipeSearchMode.Lexical) {
      try {
        embedding = await this.embeddingService.embedQuery(text, abortSignal);
      } catch (error) {
        if (
          abortSignal?.aborted ||
          !(error instanceof EmbeddingUnavailableException) ||
          mode !== RecipeSearchMode.Hybrid
        ) {
          throw error;
        }
        // Every embedding provider is down: full-text alone beats no answer.
        this.logger.warn('embedding unavailable, hybrid search falls back to full-text');
        mode = RecipeSearchMode.Lexical;
        degraded = true;
      }
    }
    const embeddingMs = Math.round(performance.now() - embeddingStartedAt);
    const prepared = { text, limit, mode, degraded, embedding, startedAt, embeddingMs };
    return Promise.all(filters.map((each) => this.rank(prepared, each)));
  }

  /** Both legs for one set of filters, the recipes loaded in the rank order. */
  private async rank(
    { text, limit, mode, degraded, embedding, startedAt, embeddingMs }: PreparedQuery,
    filters: RecipeSearchFilters,
  ): Promise<RecipeSearchResult> {
    const databaseStartedAt = performance.now();
    const rows = await this.searchRepository.search({
      // The vectors of the model that embedded the query; any model for a full-text search.
      model: embedding?.modelKey ?? this.embeddingService.modelKeys[0],
      embedding: embedding?.vector ?? null,
      text: mode === RecipeSearchMode.Semantic ? null : fullTextQuery(text),
      filters,
      candidates: Math.max(RECIPE_SEARCH_CANDIDATES, limit),
      limit,
      weights: RECIPE_SEARCH_WEIGHTS,
    });
    const recipes = new Map(
      (await this.recipeRepository.findByIds(rows.map(({ recipeId }) => recipeId))).map(
        (recipe) => [recipe.id, recipe],
      ),
    );
    const databaseMs = Math.round(performance.now() - databaseStartedAt);

    const model = embedding?.modelKey ?? null;
    const threshold = this.matchSimilarity(model);
    // A recipe deleted between the two queries is left out.
    const hits = rows.flatMap(({ recipeId, ...rank }) => {
      const recipe = recipes.get(recipeId);
      const match =
        rank.allWords ||
        (model !== null && (threshold === null || (rank.similarity ?? 0) >= threshold));
      return recipe ? [{ recipe, ...rank, match }] : [];
    });
    return this.result(hits, mode, degraded, model, startedAt, embeddingMs, databaseMs, filters);
  }

  /** Of the model that embedded the query; null for one not calibrated (or none). */
  private matchSimilarity(model: string | null): number | null {
    return model === null
      ? null
      : (this.embeddingService.models.find((spec) => embeddingModelKey(spec) === model)
          ?.matchSimilarity ?? null);
  }

  private result(
    hits: RecipeSearchHit[],
    mode: RecipeSearchMode,
    degraded: boolean,
    model: string | null,
    startedAt: number,
    embeddingMs: number,
    databaseMs: number,
    filters: RecipeSearchFilters,
  ): RecipeSearchResult {
    const matched = hits.some(({ match }) => match);
    const timings = {
      embeddingMs,
      databaseMs,
      totalMs: Math.round(performance.now() - startedAt),
    };
    const set = Object.values(filters).filter((value) => value !== undefined);
    this.logger.log(
      `recipe search mode=${mode}${degraded ? ' degraded' : ''} filters=${set.length} hits=${hits.length} matched=${matched} embedding_ms=${timings.embeddingMs} db_ms=${timings.databaseMs} ms=${timings.totalMs}`,
    );
    return { hits, mode, degraded, model, matched, timings };
  }
}
