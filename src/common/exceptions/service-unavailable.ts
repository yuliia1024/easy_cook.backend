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

/** The model answered with output that does not match the expected schema. */
export class AssistantInvalidOutputException extends ServiceUnavailableError {
  constructor() {
    super('Assistant returned invalid output');
  }
}
