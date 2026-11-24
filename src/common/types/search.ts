import type { EmbeddingProviderName, RecipeSearchMode } from '../constants/search';

/** An embedding model as the app calls it; `EMBEDDING_MODELS` pins one per provider. */
export interface EmbeddingModelSpec {
  provider: EmbeddingProviderName;
  id: string;
  /** Asked of the model (Matryoshka truncation) and checked on every vector. */
  dimensions: number;
  /** Put before a query, never before a document (instruction-tuned models); empty for none. */
  queryPrefix: string;
  /**
   * The cosine similarity from which the best recipe counts as what the query asked for
   * (`RecipeSearchResult.matched`), calibrated on the retrieval evals of the model; null when not
   * calibrated: every search with hits matches.
   */
  matchSimilarity: number | null;
  /**
   * Documents per embeddings request when indexing: one request must end within `batchTimeoutMs`
   * on the slowest machine that runs it (a CPU in CI for a local model).
   */
  batchSize: number;
  /** One batch of `batchSize` documents, retries included; past it the model counts as down. */
  batchTimeoutMs: number;
}

/** The structured filters of a search: applied in SQL to both legs before ranking. */
export interface RecipeSearchFilters {
  mealType?: string;
  /** The recipe must have at least one tag of each group (`dietTagsSatisfying`). */
  dietTypeGroups?: string[][];
  /** The recipe must contain none of them (`Allergen`). */
  excludeAllergens?: string[];
  maxPrepTimeMinutes?: number;
  excludeRecipeIds?: string[];
}

export interface RecipeSearchQuery {
  /** What the user asked for, in any language. */
  text: string;
  filters?: RecipeSearchFilters;
  /** `RECIPE_SEARCH_DEFAULT_LIMIT` when unset. */
  limit?: number;
  /** `hybrid` when unset; the evals compare the legs. */
  mode?: RecipeSearchMode;
}

/** One ranked recipe of a search, before the recipe itself is loaded. */
export interface RecipeSearchRow {
  recipeId: string;
  /** RRF score; the order of the hits. */
  score: number;
  /** 1-based rank in the semantic leg, null when it did not return the recipe. */
  semanticRank: number | null;
  lexicalRank: number | null;
  /** Cosine similarity to the query, null outside the semantic leg. */
  similarity: number | null;
  /** Every word of the query is in the recipe text (full-text, AND); false outside the lexical leg. */
  allWords: boolean;
}

/** Where the time of a search went. */
export interface RecipeSearchTimings {
  embeddingMs: number;
  databaseMs: number;
  totalMs: number;
}
