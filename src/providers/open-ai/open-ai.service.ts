import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAI } from '@ai-sdk/openai';
import { LanguageModelV4 } from '@ai-sdk/provider';
import { Injectable, Logger } from '@nestjs/common';
import {
  APICallError,
  FinishReason,
  generateText,
  isStepCount,
  LanguageModelUsage,
  ModelMessage,
  NoObjectGeneratedError,
  Output,
  RetryError,
  streamText,
  ToolSet,
  TypeValidationError,
} from 'ai';
import { z } from 'zod';
import {
  ANTHROPIC_MODEL,
  DEEPSEEK_MODEL,
  MODEL_ATTEMPT_TIMEOUT_MS,
  MODEL_CALL_TIMEOUT_MS,
  MODEL_PROVIDER_RETRIES,
  MODEL_RETRY_DELAY_MS,
  ModelProviderName,
  OPEN_AI_MODEL,
} from '../../common/constants';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
} from '../../common/exceptions';
import { ModelCallInfo, ModelPrompt, ModelRef, ModelUsage } from '../../common/types';
import { promptLabel } from '../../common/utils';
import { ModelProvidersConfigService } from '../../configs/model-providers-config/model-providers-config.service';
import { ModelFallback, ModelRoute } from './model-fallback';

/** A single prompt or a conversation, oldest message first. */
export type ModelInput = string | ModelMessage[];

export interface ModelCallOptions {
  /** The system instructions with their version; never mixed into `input`. */
  prompt: ModelPrompt;
  maxOutputTokens: number;
  abortSignal?: AbortSignal;
  /**
   * A model to call instead of `MODEL_PROVIDERS`, without fallback (retries only); only the evals
   * judge sets one.
   */
  model?: ModelRef;
  /** The provider's default unless set; 0 for answers as repeatable as the model allows. */
  temperature?: number;
}

/** A call that may run tools in a loop: one model call per step, the tool results fed back. */
export interface ToolLoopOptions extends ModelCallOptions {
  tools: ToolSet;
  /** Model calls at most; the last one may not call a tool, so the loop ends with text. */
  maxSteps: number;
  /** Checked after every step: true ends the loop, e.g. once a tool handed the request over. */
  isDone?: () => boolean;
}

type ToolLoopSettings = Pick<
  Parameters<typeof streamText>[0] & Parameters<typeof generateText>[0],
  'tools' | 'stopWhen' | 'prepareStep' | 'toolCallConcurrency'
>;

type CallSettings = Parameters<typeof streamText>[0] & Parameters<typeof generateText>[0];

/**
 * Of every provider; each one reads its own key. One tool call per step: OpenAI is asked for it,
 * DeepSeek cannot be (`toolCallConcurrency` runs its calls one by one). DeepSeek V4 thinks by
 * default, which a fallback has no time for.
 */
/** The model of every provider in `MODEL_PROVIDERS`: dated snapshots where the provider has them. */
const PROVIDER_MODELS: Record<ModelProviderName, string> = {
  [ModelProviderName.OpenAi]: OPEN_AI_MODEL,
  [ModelProviderName.DeepSeek]: DEEPSEEK_MODEL,
  [ModelProviderName.Anthropic]: ANTHROPIC_MODEL,
};

const PROVIDER_OPTIONS: CallSettings['providerOptions'] = {
  openai: { parallelToolCalls: false },
  deepseek: { thinking: { type: 'disabled' } },
};

/** A structured output with what it cost: the model that answered, time and tokens. */
export interface ModelResult<T> extends ModelCallInfo {
  output: T;
  latencyMs: number;
}

const toModelUsage = (usage: LanguageModelUsage): ModelUsage => ({
  inputTokens: usage.inputTokens ?? 0,
  cachedInputTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
  outputTokens: usage.outputTokens ?? 0,
});

interface StepSummary {
  modelId: string;
  /** The provider of the response; several when the steps of a tool loop had different ones. */
  provider: string;
  responseId: string;
  finishReason: FinishReason;
  rawFinishReason: string | undefined;
  usage: LanguageModelUsage;
}

/**
 * The only place that calls an LLM API (AI SDK): models, timeouts, retries and fallback, token
 * limits, error mapping and logging. Every call goes to the first of `MODEL_PROVIDERS` (OpenAI
 * Responses API, DeepSeek) and falls back to the next on a 5xx, timeout or rate limit
 * (`ModelFallback`); the log line of every response names its provider. Failures surface as
 * `AssistantUnavailableException` or `AssistantInvalidOutputException`; a call aborted through
 * `abortSignal` rethrows the abort as is.
 */
@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);
  /** The providers with a key: a model id to its model. */
  private readonly clients: Partial<
    Record<ModelProviderName, (modelId: string) => LanguageModelV4>
  >;
  private readonly providers: ModelProviderName[];

  constructor(config: ModelProvidersConfigService) {
    const openAi = createOpenAI({ apiKey: config.openAiApiKey });
    const deepSeek = config.deepSeekApiKey && createDeepSeek({ apiKey: config.deepSeekApiKey });
    const anthropic = config.anthropicApiKey && createAnthropic({ apiKey: config.anthropicApiKey });
    this.clients = {
      [ModelProviderName.OpenAi]: (modelId) => openAi.responses(modelId),
      ...(deepSeek && { [ModelProviderName.DeepSeek]: (modelId) => deepSeek.chat(modelId) }),
      ...(anthropic && {
        [ModelProviderName.Anthropic]: (modelId) => anthropic.messages(modelId),
      }),
    };
    this.providers = config.providers;
    const missing = this.providers.filter((provider) => !this.clients[provider]);
    if (missing.length > 0) {
      throw new Error(`MODEL_PROVIDERS has ${missing.join(', ')} without an API key`);
    }
  }

  /** Streams text generation; yields the model's text deltas. A failed call throws from the generator. */
  public async *streamText(input: ModelInput, options: ModelCallOptions): AsyncGenerator<string> {
    yield* this.stream(input, options, {});
  }

  /**
   * `streamText` with tools: the model calls tools, reads their results and goes on, up to
   * `maxSteps` model calls or until `isDone`; yields the text of every step. The tools handle their
   * own errors (the chat tool registry), so only a failed model call throws.
   */
  public async *streamWithTools(
    input: ModelInput,
    { tools, maxSteps, isDone, ...options }: ToolLoopOptions,
  ): AsyncGenerator<string> {
    yield* this.stream(input, options, this.toolLoopSettings({ tools, maxSteps, isDone }));
  }

  /**
   * `streamWithTools` without streaming, with the model id, latency and the tokens of every step
   * (evals): the same loop, so the evals measure what the chat runs.
   */
  public async generateWithToolsResult(
    input: ModelInput,
    { tools, maxSteps, isDone, ...options }: ToolLoopOptions,
  ): Promise<ModelResult<string>> {
    const startedAt = Date.now();
    try {
      const model = this.model(options);
      const result = await generateText({
        ...this.callSettings(input, options, model),
        ...this.toolLoopSettings({ tools, maxSteps, isDone }),
      });
      const step: StepSummary = {
        modelId: result.finalStep.response.modelId,
        provider: [...new Set(model.served)].join('+'),
        responseId: result.finalStep.response.id,
        finishReason: result.finishReason,
        rawFinishReason: result.rawFinishReason,
        usage: result.totalUsage,
      };
      this.logSummary(options.prompt, step, startedAt);
      return {
        output: result.text,
        modelId: step.modelId,
        usage: toModelUsage(result.totalUsage),
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      throw this.toAssistantError(error, options.abortSignal);
    }
  }

  /**
   * Up to `maxSteps` model calls, the last one without tools, or until `isDone`. One tool call per
   * step: the tools run in the order the model chose, each one seeing what the one before saved,
   * and `isDone` ends the loop right after the call that handed the request over.
   */
  private toolLoopSettings({
    tools,
    maxSteps,
    isDone = () => false,
  }: Pick<ToolLoopOptions, 'tools' | 'maxSteps' | 'isDone'>): ToolLoopSettings {
    return {
      tools,
      stopWhen: [isStepCount(maxSteps), () => isDone()],
      prepareStep: ({ stepNumber }) =>
        stepNumber >= maxSteps - 1 ? { toolChoice: 'none' } : undefined,
      toolCallConcurrency: 1,
    };
  }

  private async *stream(
    input: ModelInput,
    options: ModelCallOptions,
    toolSettings: ToolLoopSettings | Record<string, never>,
  ): AsyncGenerator<string> {
    const startedAt = Date.now();
    let firstDeltaAt: number | null = null;
    try {
      const model = this.model(options);
      const result = streamText({
        ...this.callSettings(input, options, model),
        ...toolSettings,
        // Errors arrive as `error` parts and are rethrown below; skip the default console log.
        onError: () => undefined,
      });

      for await (const part of result.stream) {
        if (part.type === 'text-delta') {
          firstDeltaAt ??= Date.now();
          yield part.text;
        } else if (part.type === 'tool-call') {
          this.logger.log(`${promptLabel(options.prompt)} called ${part.toolName}`);
        } else if (part.type === 'finish-step') {
          this.logSummary(
            options.prompt,
            {
              modelId: part.response.modelId,
              provider: model.served.at(-1) ?? 'unknown',
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
    const { output } = await this.generateStructuredResult(input, schema, options);
    return output;
  }

  /** `generateStructured` with the model id, latency and token usage of the call (evals). */
  public async generateStructuredResult<T>(
    input: ModelInput,
    schema: z.ZodType<T>,
    options: ModelCallOptions,
  ): Promise<ModelResult<T>> {
    const startedAt = Date.now();
    try {
      const model = this.model(options);
      const result = await generateText({
        ...this.callSettings(input, options, model),
        output: Output.object({ schema }),
      });
      const step: StepSummary = {
        modelId: result.finalStep.response.modelId,
        provider: model.served.at(-1) ?? 'unknown',
        responseId: result.finalStep.response.id,
        finishReason: result.finishReason,
        rawFinishReason: result.rawFinishReason,
        usage: result.usage,
      };
      this.logSummary(options.prompt, step, startedAt);
      const call: ModelCallInfo = { modelId: step.modelId, usage: toModelUsage(result.usage) };
      const parsed = schema.safeParse(result.output);
      if (!parsed.success) {
        this.logger.error(`Model call failed: ${parsed.error.message}`);
        throw new AssistantInvalidOutputException(call);
      }
      return { ...call, output: parsed.data, latencyMs: Date.now() - startedAt };
    } catch (error) {
      throw this.toAssistantError(error, options.abortSignal);
    }
  }

  /**
   * The model of one call: `MODEL_PROVIDERS` in order, or the OpenAI model the options name. A new
   * one per call, so its `served` are the providers of that call.
   */
  private model({ prompt, model }: ModelCallOptions): ModelFallback {
    const routes: ModelRoute[] = model
      ? [this.route(model.provider, model.id)]
      : this.providers.map((provider) => this.route(provider, PROVIDER_MODELS[provider]));
    return new ModelFallback(routes, {
      attemptTimeoutMs: MODEL_ATTEMPT_TIMEOUT_MS,
      retries: MODEL_PROVIDER_RETRIES,
      retryDelayMs: MODEL_RETRY_DELAY_MS,
      label: promptLabel(prompt),
      logger: this.logger,
    });
  }

  private route(provider: ModelProviderName, modelId: string): ModelRoute {
    const client = this.clients[provider];
    if (!client) {
      throw new Error(`No API key for ${provider}`);
    }
    return { provider, model: client(modelId) };
  }

  /** `maxRetries: 0`: `ModelFallback` retries every provider on its own. */
  private callSettings(
    input: ModelInput,
    { prompt, maxOutputTokens, abortSignal, temperature }: ModelCallOptions,
    model: ModelFallback,
  ): CallSettings {
    return {
      model,
      instructions: prompt.instructions,
      maxOutputTokens,
      temperature,
      maxRetries: 0,
      timeout: MODEL_CALL_TIMEOUT_MS,
      abortSignal,
      providerOptions: PROVIDER_OPTIONS,
      ...(typeof input === 'string' ? { prompt: input } : { messages: input }),
    };
  }

  private toAssistantError(error: unknown, abortSignal: AbortSignal | undefined): unknown {
    if (abortSignal?.aborted || error instanceof AssistantInvalidOutputException) {
      return error;
    }
    const cause = RetryError.isInstance(error) ? error.lastError : error;
    this.logger.error(`Model call failed: ${cause instanceof Error ? cause.message : cause}`);

    if (NoObjectGeneratedError.isInstance(cause)) {
      return new AssistantInvalidOutputException(
        cause.response && cause.usage
          ? { modelId: cause.response.modelId, usage: toModelUsage(cause.usage) }
          : null,
      );
    }
    if (TypeValidationError.isInstance(cause) || cause instanceof z.ZodError) {
      return new AssistantInvalidOutputException();
    }
    return new AssistantUnavailableException(
      APICallError.isInstance(cause) ? cause.isRetryable : true,
    );
  }

  /** Provider, model, prompt version, outcome, timings and token usage of a finished response. */
  private logSummary(
    prompt: ModelPrompt,
    step: StepSummary,
    startedAt: number,
    firstDeltaAt?: number | null,
  ): void {
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
      `${step.provider} ${step.modelId} ${promptLabel(prompt)} ${step.responseId} ${step.finishReason} in ${Date.now() - startedAt}ms` +
      `${firstDelta}, ${tokens}`;

    if (step.finishReason === 'stop' || step.finishReason === 'tool-calls') {
      this.logger.log(summary);
    } else {
      this.logger.warn(`${summary}; reason: ${step.rawFinishReason ?? step.finishReason}`);
    }
  }
}
