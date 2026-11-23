import { EMBEDDING_DIMENSIONS, EMBEDDING_MODELS, EmbeddingProviderName } from '../common/constants';
import { embeddingModelKey } from '../common/utils';
import {
  EmbeddingBatch,
  EmbeddingService,
  QueryEmbedding,
} from '../providers/embedding/embedding.service';

/**
 * A deterministic stand-in for an embedding model: a normalised bag of hashed words, so texts that
 * share words are close (cosine) and the rest are not. No model, no network: specs and e2e tests
 * use it instead of `EmbeddingService`.
 */
export function fakeEmbedding(text: string, dimensions = EMBEDDING_DIMENSIONS): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let hash = 2166136261;
    for (const char of word) {
      hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
    }
    vector[(hash >>> 0) % dimensions] += 1;
  }
  const norm = Math.hypot(...vector);
  // An empty text still needs a valid vector.
  return norm === 0 ? vector.map((_, i) => (i === 0 ? 1 : 0)) : vector.map((value) => value / norm);
}

/** The model key `createFakeEmbeddingService` answers queries with: the local one. */
export const FAKE_EMBEDDING_MODEL_KEY = embeddingModelKey(
  EMBEDDING_MODELS[EmbeddingProviderName.Ollama],
);

/**
 * An `EmbeddingService` of the pinned local model (`models`: only it) whose vectors are
 * `fakeEmbedding`; every method is a `jest.fn` a spec can override.
 */
export function createFakeEmbeddingService(): jest.Mocked<EmbeddingService> {
  const model = EMBEDDING_MODELS[EmbeddingProviderName.Ollama];
  const service = {
    // Not the calibration of the real model: every search with hits matches unless a spec says.
    models: [{ ...model, matchSimilarity: null }],
    modelKeys: [FAKE_EMBEDDING_MODEL_KEY],
    embedQuery: jest.fn((text: string): Promise<QueryEmbedding> =>
      Promise.resolve({ vector: fakeEmbedding(text), modelKey: FAKE_EMBEDDING_MODEL_KEY }),
    ),
    embedDocuments: jest.fn((_modelKey: string, texts: string[]): Promise<EmbeddingBatch> =>
      Promise.resolve({
        embeddings: texts.map((text) => fakeEmbedding(text)),
        tokens: texts.length,
      }),
    ),
  };
  return service as unknown as jest.Mocked<EmbeddingService>;
}
