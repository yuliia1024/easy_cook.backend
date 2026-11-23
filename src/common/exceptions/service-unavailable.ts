import { ModelCallInfo } from '../types';
import { ServiceUnavailableError } from './app-error';

export class DatabaseUnavailableException extends ServiceUnavailableError {
  constructor() {
    super('Database is unavailable');
  }
}

/** The model API failed or timed out; `retryable` when the same call may succeed later. */
export class AssistantUnavailableException extends ServiceUnavailableError {
  constructor(public readonly retryable = true) {
    super('Assistant is unavailable');
  }
}

/**
 * The model answered with output that does not match the expected schema. `call` is the model and
 * the tokens of that answer when the API reported them (evals count its cost).
 */
export class AssistantInvalidOutputException extends ServiceUnavailableError {
  constructor(public readonly call: ModelCallInfo | null = null) {
    super('Assistant returned invalid output');
  }
}

/** The embeddings API (or the local model) failed or timed out: no search, no indexing. */
export class EmbeddingUnavailableException extends ServiceUnavailableError {
  constructor() {
    super('Embedding model is unavailable');
  }
}

/** The model answered vectors of another size than `EMBEDDING_DIMENSIONS`: a wrong model. */
export class EmbeddingDimensionsMismatchException extends ServiceUnavailableError {
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(`Embedding model returned ${actual} dimensions, expected ${expected}`);
  }
}
