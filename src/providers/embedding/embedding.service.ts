import { createOpenAI } from '@ai-sdk/openai';
import { EmbeddingModelV4 } from '@ai-sdk/provider';
import { Injectable, Logger } from '@nestjs/common';
import { embedMany } from 'ai';
import {
  EMBEDDING_BATCH_TIMEOUT_MS,
  EMBEDDING_MAX_PARALLEL_CALLS,
  EMBEDDING_MAX_RETRIES,
  EMBEDDING_PROVIDER_COOLDOWN_MS,
  EMBEDDING_QUERY_TIMEOUT_MS,
  EmbeddingProviderName,
} from '../../common/constants';
import {
  EmbeddingDimensionsMismatchException,
  EmbeddingUnavailableException,
} from '../../common/exceptions';
import { EmbeddingModelSpec } from '../../common/types';
import { embeddingModelKey } from '../../common/utils';
import { EmbeddingConfigService } from '../../configs/embedding-config/embedding-config.service';

/** Vectors in the order of the texts, and the tokens the provider counted (0 when it did not). */
export interface EmbeddingBatch {
  embeddings: number[][];
  tokens: number;
}

/** A query vector and the model that made it: it is searched among that model's vectors only. */
export interface QueryEmbedding {
  vector: number[];
  modelKey: string;
}

interface EmbeddingRoute {
  model: EmbeddingModelSpec;
  /** `embeddingModelKey(model)`, stored with every vector. */
  key: string;
  client: EmbeddingModelV4;
  /** `performance.now()` until which a failed provider is skipped by queries. */
  skipUntil: number;
}

const elapsedSince = (startedAt: number): number => Math.round(performance.now() - startedAt);

/**
 * The only code that calls an embedding model (AI SDK). `EMBEDDING_PROVIDERS` in order - the local
 * Ollama (OpenAI-compatible API), then OpenAI: a query goes to the first that answers, and a
 * provider that failed is skipped for `EMBEDDING_PROVIDER_COOLDOWN_MS`. Documents are embedded by
 * a named model (each has its own vectors). Checks the size of every vector; one log line per call
 * with the model, inputs, tokens and time - never the text.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly routes: EmbeddingRoute[];

  constructor(config: EmbeddingConfigService) {
    this.routes = config.models.map((model) => {
      const provider =
        model.provider === EmbeddingProviderName.Ollama
          ? // Ollama ignores the key; the SDK requires one.
            createOpenAI({ baseURL: `${config.ollamaBaseUrl}/v1`, apiKey: 'ollama' })
          : createOpenAI({ apiKey: config.openAiApiKey });
      return {
        model,
        key: embeddingModelKey(model),
        client: provider.embedding(model.id),
        skipUntil: 0,
      };
    });
  }

  /** The models in the order they are tried. */
  public get models(): EmbeddingModelSpec[] {
    return this.routes.map(({ model }) => model);
  }

  /** `embeddingModelKey` of every model, in order. */
  public get modelKeys(): string[] {
    return this.routes.map(({ key }) => key);
  }

  /**
   * A search query, with the query prefix of the model that serves it. Throws
   * `EmbeddingUnavailableException` when no provider answers; a wrong vector size is never retried.
   */
  public async embedQuery(text: string, abortSignal?: AbortSignal): Promise<QueryEmbedding> {
    const now = performance.now();
    const routes = this.routes.filter(({ skipUntil }) => skipUntil <= now);
    // When every provider is cooling down, try them all rather than fail without a call.
    const candidates = routes.length > 0 ? routes : this.routes;
    for (const [index, route] of candidates.entries()) {
      const last = index === candidates.length - 1;
      try {
        const { embeddings } = await this.embed(
          route,
          [`${route.model.queryPrefix}${text}`],
          EMBEDDING_QUERY_TIMEOUT_MS,
          last ? EMBEDDING_MAX_RETRIES : 0,
          abortSignal,
        );
        route.skipUntil = 0;
        return { vector: embeddings[0], modelKey: route.key };
      } catch (error) {
        if (!(error instanceof EmbeddingUnavailableException) || abortSignal?.aborted) {
          throw error;
        }
        route.skipUntil = performance.now() + EMBEDDING_PROVIDER_COOLDOWN_MS;
        if (!last) {
          this.logger.warn(
            `embedding falls back from ${route.key} to ${candidates[index + 1].key}`,
          );
        }
      }
    }
    throw new EmbeddingUnavailableException();
  }

  /** Documents as they are, by the model of `modelKey`, in requests of the provider's batch size. */
  public async embedDocuments(modelKey: string, texts: string[]): Promise<EmbeddingBatch> {
    const route = this.routes.find(({ key }) => key === modelKey);
    if (!route) {
      throw new Error(`Unknown embedding model ${modelKey}`);
    }
    if (texts.length === 0) {
      return { embeddings: [], tokens: 0 };
    }
    return this.embed(route, texts, EMBEDDING_BATCH_TIMEOUT_MS, EMBEDDING_MAX_RETRIES);
  }

  private async embed(
    { model, key, client }: EmbeddingRoute,
    values: string[],
    timeoutMs: number,
    maxRetries: number,
    abortSignal?: AbortSignal,
  ): Promise<EmbeddingBatch> {
    const startedAt = performance.now();
    const signals = [AbortSignal.timeout(timeoutMs), ...(abortSignal ? [abortSignal] : [])];
    let batch: EmbeddingBatch;
    try {
      const result = await embedMany({
        model: client,
        values,
        dimensions: model.dimensions,
        maxRetries,
        maxParallelCalls: EMBEDDING_MAX_PARALLEL_CALLS,
        abortSignal: AbortSignal.any(signals),
      });
      batch = { embeddings: result.embeddings, tokens: result.usage?.tokens ?? 0 };
    } catch (error) {
      this.logger.warn(
        `embedding failed model=${key} inputs=${values.length} ms=${elapsedSince(startedAt)}: ${
          error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)
        }`,
      );
      throw new EmbeddingUnavailableException();
    }
    const wrong = batch.embeddings.find((vector) => vector.length !== model.dimensions);
    if (wrong || batch.embeddings.length !== values.length) {
      throw new EmbeddingDimensionsMismatchException(
        model.dimensions,
        wrong?.length ?? batch.embeddings.length,
      );
    }
    this.logger.log(
      `embedded model=${key} inputs=${values.length} tokens=${batch.tokens} ms=${elapsedSince(startedAt)}`,
    );
    return batch;
  }
}
