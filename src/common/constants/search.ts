import type { EmbeddingModelSpec } from '../types';

/** Who embeds the recipe documents and the search queries (`EMBEDDING_PROVIDERS`). */
export enum EmbeddingProviderName {
  /** A self-hosted Ollama server (`OLLAMA_BASE_URL`): the model runs on our machine. */
  Ollama = 'ollama',
  /** The OpenAI API: serves when the local model is not there. */
  OpenAi = 'openai',
}

/** The local model first; OpenAI takes over a query when it is down or not installed. */
export const DEFAULT_EMBEDDING_PROVIDERS: readonly EmbeddingProviderName[] = [
  EmbeddingProviderName.Ollama,
  EmbeddingProviderName.OpenAi,
];
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

/**
 * The size of `recipe_embeddings.embedding` (`vector(1024)`): every model is asked for it, so the
 * column and the HNSW index serve them all. Changing it needs a migration and a full re-index.
 */
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * The model of every provider; its `key` is stored with every vector, so vectors of two models are
 * never compared. A new model (or a new `dimensions`) is a new key: run `npm run search:index`.
 * OpenAI has no dated embedding snapshots: `text-embedding-3-large` has not changed since 2024-01.
 */
export const EMBEDDING_MODELS: Readonly<Record<EmbeddingProviderName, EmbeddingModelSpec>> = {
  [EmbeddingProviderName.OpenAi]: {
    provider: EmbeddingProviderName.OpenAi,
    id: 'text-embedding-3-large',
    dimensions: EMBEDDING_DIMENSIONS,
    queryPrefix: '',
    // Not calibrated yet: index with OpenAI and run the retrieval evals (docs/notes/rag-recipe-search.md).
    matchSimilarity: null,
    // OpenAI takes up to 2048 texts a request.
    batchSize: 64,
    batchTimeoutMs: 60_000,
  },
  [EmbeddingProviderName.Ollama]: {
    provider: EmbeddingProviderName.Ollama,
    // An explicit quantization tag: `0.6b` / `latest` are aliases Ollama may repoint.
    id: 'qwen3-embedding:0.6b-q8_0',
    dimensions: EMBEDDING_DIMENSIONS,
    // Qwen3-Embedding is trained with an instruction on the query side only; documents go as they are.
    queryPrefix:
      'Instruct: Given a request for a dish, a meal or a recipe, retrieve the recipes that fit it\nQuery: ',
    // The retrieval evals (2026-11-23): the best recipe of a dish the catalog lacks (sushi, pizza,
    // tiramisu...) is at most ~0.50, that of a query with answers mostly 0.5-0.67.
    matchSimilarity: 0.5,
    // ~1 s a document on a CPU (an Intel laptop; a 4-core CI runner is slower): a batch of 64 ran
    // past a 60 s timeout. Small batches cost no speed on a CPU and leave a slow machine room.
    batchSize: 8,
    batchTimeoutMs: 120_000,
  },
};

/** Requests of one indexing run in flight at once. */
export const EMBEDDING_MAX_PARALLEL_CALLS = 2;
/** One query embedding, retries included: it sits on the path of a chat reply. */
export const EMBEDDING_QUERY_TIMEOUT_MS = 5_000;
/** Of the AI SDK, on a 5xx, 429 or network error; a query with a next provider is not retried. */
export const EMBEDDING_MAX_RETRIES = 2;
/** A provider that failed a query is skipped this long, so a dead local server costs one try. */
export const EMBEDDING_PROVIDER_COOLDOWN_MS = 30_000;

/** Raised with every change of `buildRecipeDocument`: every document is rebuilt and re-embedded. */
export const RECIPE_DOCUMENT_VERSION = 2;
/** Of the instructions in a document: the method matters, its tail does not. */
export const RECIPE_DOCUMENT_INSTRUCTIONS_MAX_LENGTH = 600;
/**
 * Postgres text search configuration of `recipe_search_documents.search_vector`. The documents are
 * English with translated lines; Postgres has no Ukrainian stemmer, so those match by exact word.
 */
export const RECIPE_SEARCH_TS_CONFIG = 'english';

export enum RecipeSearchMode {
  /** Both legs fused by Reciprocal Rank Fusion. */
  Hybrid = 'hybrid',
  /** Vector similarity alone. */
  Semantic = 'semantic',
  /** Postgres full-text search alone. */
  Lexical = 'lexical',
}

export const RECIPE_SEARCH_QUERY_MAX_LENGTH = 500;
/**
 * Shorter words of a query are left out of the full-text search: Postgres has no Ukrainian stop
 * words, and "на", "з", "і" would match nearly every translated recipe.
 */
export const RECIPE_SEARCH_MIN_WORD_LENGTH = 3;
export const RECIPE_SEARCH_DEFAULT_LIMIT = 10;
export const RECIPE_SEARCH_MAX_LIMIT = 50;
/** Candidates each leg hands to the fusion, at least the limit. */
export const RECIPE_SEARCH_CANDIDATES = 50;
/** RRF constant: score = sum of weight / (k + rank); 60 is the value of the original paper. */
export const RECIPE_SEARCH_RRF_K = 60;
/** Weights of the legs in the fusion. */
export const RECIPE_SEARCH_WEIGHTS = { semantic: 1, lexical: 1 } as const;
/**
 * `hnsw.ef_search` of a search: the candidate list of the index scan, at least the candidates.
 * With filters the scan goes on (`hnsw.iterative_scan = relaxed_order`) until enough rows pass.
 */
export const RECIPE_SEARCH_EF_SEARCH = 100;
