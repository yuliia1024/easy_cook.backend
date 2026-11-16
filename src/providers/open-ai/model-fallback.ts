import {
  APICallError,
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from '@ai-sdk/provider';
import { Logger } from '@nestjs/common';
import { ModelProviderName } from '../../common/constants';

/** A model of a provider; `ModelFallback` tries them in order. */
export interface ModelRoute {
  provider: ModelProviderName;
  model: LanguageModelV4;
}

export interface ModelFallbackSettings {
  /** One request until the response, or the first output of a stream. */
  attemptTimeoutMs: number;
  /** Retries of a provider before the next one. */
  retries: number;
  /** Before the first retry, doubled for every next one. */
  retryDelayMs: number;
  /** Names the call in the log lines (`promptLabel`). */
  label: string;
  logger: Logger;
}

/** Stream parts that come before the model's output and say nothing about whether it will come. */
const PREAMBLE_PARTS = new Set<LanguageModelV4StreamPart['type']>([
  'stream-start',
  'response-metadata',
]);

/** A failure that is worth another try: the provider is down, slow or busy, not the request wrong. */
const isTransient = (error: unknown): boolean =>
  APICallError.isInstance(error) && error.isRetryable;

const transientError = (message: string, cause?: unknown): APICallError =>
  new APICallError({ message, url: '', requestBodyValues: {}, isRetryable: true, cause });

const describe = (error: unknown): string => {
  if (APICallError.isInstance(error)) {
    return error.statusCode ? `${error.statusCode} ${error.message}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
};

const sleep = (ms: number, signal: AbortSignal | undefined): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/**
 * A language model that calls the routes in order: a provider that fails with a 5xx, 408, 409,
 * 429, a network error or no answer within `attemptTimeoutMs` is retried with backoff, then the
 * next one is called. Any other failure (a bad request, invalid output) and the caller's abort end
 * the call at once; the last failure is thrown when every route failed.
 *
 * It wraps one model call (one step of a tool loop), so a fallback never runs a tool twice. A
 * stream is switched only before its first output: an error after it reaches the caller. Run the
 * SDK call with `maxRetries: 0`, or it retries every route again. One instance serves one call:
 * `served` lists the provider of every response, in order.
 */
export class ModelFallback implements LanguageModelV4 {
  public readonly specificationVersion = 'v4';
  public readonly provider: string;
  public readonly modelId: string;
  public readonly served: ModelProviderName[] = [];

  constructor(
    private readonly routes: ModelRoute[],
    private readonly settings: ModelFallbackSettings,
  ) {
    if (routes.length === 0) {
      throw new Error('ModelFallback needs at least one route');
    }
    this.provider = routes[0].model.provider;
    this.modelId = routes[0].model.modelId;
  }

  public get supportedUrls(): LanguageModelV4['supportedUrls'] {
    return this.routes[0].model.supportedUrls;
  }

  public doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
    return this.call(options, (model, callOptions) => model.doGenerate(callOptions));
  }

  public doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> {
    return this.call(options, async (model, callOptions) => {
      const result = await model.doStream(callOptions);
      return {
        ...result,
        stream: await this.untilFirstOutput(result.stream, callOptions.abortSignal),
      };
    });
  }

  private async call<T>(
    options: LanguageModelV4CallOptions,
    run: (model: LanguageModelV4, options: LanguageModelV4CallOptions) => PromiseLike<T>,
  ): Promise<T> {
    const { attemptTimeoutMs, retries, retryDelayMs, label, logger } = this.settings;
    const failures: string[] = [];
    let lastError: unknown;

    for (const [routeIndex, { provider, model }] of this.routes.entries()) {
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) {
          await sleep(retryDelayMs * 2 ** (attempt - 1), options.abortSignal);
        }
        const timeout = new AbortController();
        const timer = setTimeout(
          () => timeout.abort(transientError(`No answer within ${attemptTimeoutMs}ms`)),
          attemptTimeoutMs,
        );
        const abortSignal = options.abortSignal
          ? AbortSignal.any([options.abortSignal, timeout.signal])
          : timeout.signal;

        try {
          const result = await run(model, { ...options, abortSignal });
          this.served.push(provider);
          if (failures.length > 0) {
            logger.warn(
              `${label} served by ${provider} (${model.modelId}) after ${failures.join('; ')}`,
            );
          }
          return result;
        } catch (error) {
          if (options.abortSignal?.aborted) {
            throw error;
          }
          lastError = timeout.signal.aborted ? timeout.signal.reason : error;
          if (!isTransient(lastError)) {
            throw lastError;
          }
          const failure = `${provider} (${model.modelId}) failed: ${describe(lastError)}`;
          failures.push(failure);
          const next =
            attempt < retries
              ? 'retrying'
              : routeIndex < this.routes.length - 1
                ? `falling back to ${this.routes[routeIndex + 1].provider}`
                : 'no provider left';
          logger.warn(`${label} ${failure}; ${next}`);
        } finally {
          clearTimeout(timer);
        }
      }
    }
    throw lastError;
  }

  /**
   * Reads the stream up to its first output, so a provider that fails or hangs before it can still
   * be replaced; returns a stream with the parts read and the rest. A read waits for `abortSignal`
   * too: a provider stream may not end when its request is aborted.
   */
  private async untilFirstOutput(
    stream: ReadableStream<LanguageModelV4StreamPart>,
    abortSignal: AbortSignal | undefined,
  ): Promise<ReadableStream<LanguageModelV4StreamPart>> {
    const reader = stream.getReader();
    const aborted = new Promise<never>((_, reject) => {
      if (abortSignal?.aborted) {
        reject(abortSignal.reason);
      }
      abortSignal?.addEventListener('abort', () => reject(abortSignal.reason), { once: true });
    });
    aborted.catch(() => undefined);
    const head: LanguageModelV4StreamPart[] = [];
    let done = false;
    try {
      for (;;) {
        const next = await Promise.race([reader.read(), aborted]);
        if (next.done) {
          done = true;
          break;
        }
        if (next.value.type === 'error') {
          throw transientError(`Stream failed: ${describe(next.value.error)}`, next.value.error);
        }
        head.push(next.value);
        if (!PREAMBLE_PARTS.has(next.value.type)) {
          break;
        }
      }
    } catch (error) {
      reader.cancel().catch(() => undefined);
      throw error;
    }

    return new ReadableStream<LanguageModelV4StreamPart>({
      start(controller): void {
        head.forEach((part) => controller.enqueue(part));
        if (done) {
          controller.close();
        }
      },
      async pull(controller): Promise<void> {
        const next = await reader.read();
        if (next.done) {
          controller.close();
        } else {
          controller.enqueue(next.value);
        }
      },
      cancel(reason): Promise<void> {
        return reader.cancel(reason);
      },
    });
  }
}
