import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai';
import { Injectable, Logger } from '@nestjs/common';
import {
  APICallError,
  FinishReason,
  generateText,
  LanguageModelUsage,
  ModelMessage,
  NoObjectGeneratedError,
  Output,
  RetryError,
  streamText,
  TypeValidationError,
} from 'ai';
import { z } from 'zod';
import { OPEN_AI_MODEL, OPEN_AI_TIMEOUT_MS } from '../../common/constants';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
} from '../../common/exceptions';
import { OpenAiConfigService } from '../../configs/open-ai-config/open-ai-config.service';

/** A single prompt or a conversation, oldest message first. */
export type ModelInput = string | ModelMessage[];

export interface ModelCallOptions {
  /** The system instructions; never mixed into `input`. */
  instructions: string;
  maxOutputTokens: number;
  abortSignal?: AbortSignal;
}

interface StepSummary {
  modelId: string;
  responseId: string;
  finishReason: FinishReason;
  rawFinishReason: string | undefined;
  usage: LanguageModelUsage;
}

/**
 * The only place that calls the OpenAI API (AI SDK, Responses API): model, timeout, token limits,
 * error mapping and logging. Failures surface as `AssistantUnavailableException` or
 * `AssistantInvalidOutputException`; a call aborted through `abortSignal` rethrows the abort as is.
 */
@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);
  private readonly provider: OpenAIProvider;

  constructor(openAiConfig: OpenAiConfigService) {
    this.provider = createOpenAI({ apiKey: openAiConfig.apiKey });
  }

  /** Streams text generation; yields the model's text deltas. A failed call throws from the generator. */
  public async *streamText(input: ModelInput, options: ModelCallOptions): AsyncGenerator<string> {
    const startedAt = Date.now();
    let firstDeltaAt: number | null = null;
    try {
      const result = streamText({
        ...this.callSettings(input, options),
        // Errors arrive as `error` parts and are rethrown below; skip the default console log.
        onError: () => undefined,
      });

      for await (const part of result.stream) {
        if (part.type === 'text-delta') {
          firstDeltaAt ??= Date.now();
          yield part.text;
        } else if (part.type === 'finish-step') {
          this.logSummary(
            {
              modelId: part.response.modelId,
              responseId: part.response.id,
              finishReason: part.finishReason,
              rawFinishReason: part.rawFinishReason,
              usage: part.usage,
            },
            startedAt,
            firstDeltaAt,
          );
        } else if (part.type === 'error') {
          throw part.error;
        }
      }
    } catch (error) {
      throw this.toAssistantError(error, options.abortSignal);
    }
  }

  /**
   * Generates an object that matches `schema` (Structured Outputs). The result is parsed with the
   * schema again, so the caller never gets an unchecked value.
   */
  public async generateStructured<T>(
    input: ModelInput,
    schema: z.ZodType<T>,
    options: ModelCallOptions,
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await generateText({
        ...this.callSettings(input, options),
        output: Output.object({ schema }),
      });
      this.logSummary(
        {
          modelId: result.finalStep.response.modelId,
          responseId: result.finalStep.response.id,
          finishReason: result.finishReason,
          rawFinishReason: result.rawFinishReason,
          usage: result.usage,
        },
        startedAt,
      );
      return schema.parse(result.output);
    } catch (error) {
      throw this.toAssistantError(error, options.abortSignal);
    }
  }

  private callSettings(
    input: ModelInput,
    { instructions, maxOutputTokens, abortSignal }: ModelCallOptions,
  ): Parameters<typeof streamText>[0] & Parameters<typeof generateText>[0] {
    return {
      model: this.provider.responses(OPEN_AI_MODEL),
      instructions,
      maxOutputTokens,
      timeout: OPEN_AI_TIMEOUT_MS,
      abortSignal,
      ...(typeof input === 'string' ? { prompt: input } : { messages: input }),
    };
  }

  private toAssistantError(error: unknown, abortSignal: AbortSignal | undefined): unknown {
    if (abortSignal?.aborted) {
      return error;
    }
    const cause = RetryError.isInstance(error) ? error.lastError : error;
    this.logger.error(`OpenAI call failed: ${cause instanceof Error ? cause.message : cause}`);

    if (
      NoObjectGeneratedError.isInstance(cause) ||
      TypeValidationError.isInstance(cause) ||
      cause instanceof z.ZodError
    ) {
      return new AssistantInvalidOutputException();
    }
    return new AssistantUnavailableException(
      APICallError.isInstance(cause) ? cause.isRetryable : true,
    );
  }

  /** Model, outcome, timings and token usage of a finished response. */
  private logSummary(step: StepSummary, startedAt: number, firstDeltaAt?: number | null): void {
    const { usage } = step;
    const tokens =
      usage.totalTokens === undefined
        ? 'tokens: unknown'
        : `tokens: ${usage.inputTokens} in (${usage.inputTokenDetails.cacheReadTokens ?? 0} cached)` +
          ` + ${usage.outputTokens} out (${usage.outputTokenDetails.reasoningTokens ?? 0} reasoning)` +
          ` = ${usage.totalTokens}`;
    const firstDelta =
      firstDeltaAt === undefined
        ? ''
        : ` (first text after ${firstDeltaAt === null ? 'none' : `${firstDeltaAt - startedAt}ms`})`;
    const summary =
      `${step.modelId} ${step.responseId} ${step.finishReason} in ${Date.now() - startedAt}ms` +
      `${firstDelta}, ${tokens}`;

    if (step.finishReason === 'stop') {
      this.logger.log(summary);
    } else {
      this.logger.warn(`${summary}; reason: ${step.rawFinishReason ?? step.finishReason}`);
    }
  }
}
