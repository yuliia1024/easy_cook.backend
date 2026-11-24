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
  StepResultPerformance,
  streamText,
  ToolSet,
  TypeValidationError,
} from 'ai';
import { z } from 'zod';
import {
  MODEL_ATTEMPT_TIMEOUT_MS,
  MODEL_CALL_TIMEOUT_MS,
  MODEL_PROVIDER_RETRIES,
  MODEL_RETRY_DELAY_MS,
  ModelProviderName,
} from '../../common/constants';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
} from '../../common/exceptions';
import { recordModelCall } from '../../common/logger';
import {
  ModelCallInfo,
  ModelCallRecord,
  ModelPrompt,
  ModelRef,
  ModelUsage,
} from '../../common/types';
import { promptLabel } from '../../common/utils';
import { ModelProvidersConfigService } from '../../configs/model-providers-config/model-providers-config.service';
import { ModelFallback, ModelRoute } from './model-fallback';
import { TracingService } from '../tracing/tracing.service';
import { MODEL_VENDORS } from './vendors';

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

/** Where a step of a tool loop sits in the call, and where its time went (`finish-step`). */
interface StepTiming {
  /** From 1. */
  step: number;
  /** Since the call started. */
  startedAtMs: number;
  /** Since the step before ended; null for the first step. */
  gapMs: number | null;
  performance: StepResultPerformance;
}

/** How a call that never reached its `finish-step` or response ended. */
type UnfinishedReason = 'aborted' | 'failed';

const elapsedSince = (startedAt: number): number => Math.round(performance.now() - startedAt);

/**
 * The only place that calls an LLM API (AI SDK): timeouts, retries and fallback, token limits,
 * error mapping and logging. Every call goes to the first of `MODEL_PROVIDERS` and falls back to
 * the next on a 5xx, timeout or rate limit (`ModelFallback`); the vendors, their models and options
 * are in `vendors/`, and no caller knows which one answered but from the logs. Failures surface as
 * `AssistantUnavailableException` or `AssistantInvalidOutputException`; a call aborted through
 * `abortSignal` rethrows the abort as is.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  /** The providers with a key: a model id to its model. */
  private readonly clients: Partial<
    Record<ModelProviderName, (modelId: string) => LanguageModelV4>
  >;
  private readonly providers: ModelProviderName[];

  constructor(
    config: ModelProvidersConfigService,
    private readonly tracing: TracingService,
  ) {
    this.clients = Object.fromEntries(
      Object.values(MODEL_VENDORS).flatMap((vendor) => {
        const apiKey = vendor.apiKey(config);
        return apiKey ? [[vendor.name, vendor.connect(apiKey)]] : [];
      }),
    );
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
    const startedAt = performance.now();
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
      this.logSummary(options.prompt, step, elapsedSince(startedAt));
      return {
        output: result.text,
        modelId: step.modelId,
        usage: toModelUsage(result.totalUsage),
        latencyMs: elapsedSince(startedAt),
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

  /**
   * Logs every step of the loop with its timing (`StepTiming`) and every tool the model called; a
   * step that never finishes (aborted, failed, or the caller stopped reading) is logged too, with
   * its time and unknown tokens.
   */
  private async *stream(
    input: ModelInput,
    options: ModelCallOptions,
    toolSettings: ToolLoopSettings | Record<string, never>,
  ): AsyncGenerator<string> {
    const label = promptLabel(options.prompt);
    const startedAt = performance.now();
    let model: ModelFallback | undefined;
    let step = 1;
    let stepStartedAt = startedAt;
    let lastStepEndedAt: number | null = null;
    let finished = false;
    let failed = false;
    try {
      model = this.model(options);
      const result = streamText({
        ...this.callSettings(input, options, model),
        ...toolSettings,
        // Errors arrive as `error` parts and are rethrown below; skip the default console log.
        onError: () => undefined,
      });

      for await (const part of result.stream) {
        if (part.type === 'text-delta') {
          yield part.text;
        } else if (part.type === 'tool-call') {
          this.logger.log(`${label} step ${step} called ${part.toolName} (${part.toolCallId})`);
        } else if (part.type === 'finish-step') {
          const endedAt = performance.now();
          const stepStart = Math.max(endedAt - part.performance.stepTimeMs, startedAt);
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
            part.performance.stepTimeMs,
            {
              step,
              startedAtMs: Math.round(stepStart - startedAt),
              gapMs:
                lastStepEndedAt === null
                  ? null
                  : Math.round(Math.max(stepStart - lastStepEndedAt, 0)),
              performance: part.performance,
            },
          );
          lastStepEndedAt = endedAt;
          step += 1;
          stepStartedAt = endedAt;
        } else if (part.type === 'finish') {
          finished = true;
        } else if (part.type === 'error') {
          throw part.error;
        }
      }
    } catch (error) {
      failed = !options.abortSignal?.aborted;
      throw this.toAssistantError(error, options.abortSignal);
    } finally {
      if (!finished) {
        this.logUnfinished(label, model?.served[step - 1], step, stepStartedAt, failed);
      }
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
    const startedAt = performance.now();
    let model: ModelFallback | undefined;
    let responded = false;
    try {
      model = this.model(options);
      const result = await generateText({
        ...this.callSettings(input, options, model),
        output: Output.object({ schema }),
      });
      responded = true;
      const step: StepSummary = {
        modelId: result.finalStep.response.modelId,
        provider: model.served.at(-1) ?? 'unknown',
        responseId: result.finalStep.response.id,
        finishReason: result.finishReason,
        rawFinishReason: result.rawFinishReason,
        usage: result.usage,
      };
      this.logSummary(options.prompt, step, elapsedSince(startedAt));
      const call: ModelCallInfo = { modelId: step.modelId, usage: toModelUsage(result.usage) };
      const parsed = schema.safeParse(result.output);
      if (!parsed.success) {
        this.logger.error(`Model call failed: ${parsed.error.message}`);
        throw new AssistantInvalidOutputException(call);
      }
      return { ...call, output: parsed.data, latencyMs: elapsedSince(startedAt) };
    } catch (error) {
      if (!responded) {
        this.logUnfinished(
          promptLabel(options.prompt),
          model?.served.at(-1),
          1,
          startedAt,
          !options.abortSignal?.aborted,
          NoObjectGeneratedError.isInstance(error) && error.usage
            ? toModelUsage(error.usage)
            : null,
        );
      }
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
      : this.providers.map((provider) => this.route(provider, MODEL_VENDORS[provider].model));
    return new ModelFallback(routes, {
      attemptTimeoutMs: MODEL_ATTEMPT_TIMEOUT_MS,
      retries: MODEL_PROVIDER_RETRIES,
      retryDelayMs: MODEL_RETRY_DELAY_MS,
      label: promptLabel(prompt),
      logger: this.logger,
      onServed: ({ provider, modelId }) => this.tracing.markServed(provider, modelId),
    });
  }

  private route(provider: ModelProviderName, modelId: string): ModelRoute {
    const client = this.clients[provider];
    if (!client) {
      throw new Error(`No API key for ${provider}`);
    }
    return {
      provider,
      model: client(modelId),
      providerOptions: MODEL_VENDORS[provider].providerOptions,
    };
  }

  /**
   * `maxRetries: 0`: `ModelFallback` retries every provider on its own and adds its
   * `providerOptions`.
   */
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
      ...(typeof input === 'string' ? { prompt: input } : { messages: input }),
      ...this.tracing.callTelemetry(promptLabel(prompt)),
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

  /**
   * Logs a finished response - provider, model, prompt version, outcome, time and tokens; for a
   * step of a stream also its place in the loop, the wait since the step before, the model's time,
   * its first output and the tools - and records it for the request (`recordModelCall`).
   */
  private logSummary(
    prompt: ModelPrompt,
    step: StepSummary,
    durationMs: number,
    timing?: StepTiming,
  ): void {
    const { usage } = step;
    const tokens =
      usage.totalTokens === undefined
        ? 'tokens: unknown'
        : `tokens: ${usage.inputTokens} in (${usage.inputTokenDetails.cacheReadTokens ?? 0} cached)` +
          ` + ${usage.outputTokens} out (${usage.outputTokenDetails.reasoningTokens ?? 0} reasoning)` +
          ` = ${usage.totalTokens}`;
    const label = promptLabel(prompt);
    const summary =
      `${step.provider} ${step.modelId} ${label}${timing ? ` step ${timing.step}` : ''} ` +
      `${step.responseId} ${step.finishReason} in ${Math.round(durationMs)}ms` +
      `${timing ? ` (${describeTiming(timing)})` : ''}, ${tokens}`;

    if (step.finishReason === 'stop' || step.finishReason === 'tool-calls') {
      this.logger.log(summary);
    } else {
      this.logger.warn(`${summary}; reason: ${step.rawFinishReason ?? step.finishReason}`);
    }
    recordModelCall({
      prompt: label,
      provider: step.provider,
      modelId: step.modelId,
      step: timing?.step ?? 1,
      durationMs: Math.round(durationMs),
      usage: usage.totalTokens === undefined ? null : toModelUsage(usage),
      finishReason: step.finishReason,
    });
  }

  /**
   * A call or step that ended before its response: aborted (the caller's signal, or the caller
   * stopped reading the stream) or failed. Its tokens are unknown unless the error reports them,
   * though the provider may bill them.
   */
  private logUnfinished(
    label: string,
    provider: string | undefined,
    step: number,
    startedAt: number,
    failed: boolean,
    usage: ModelUsage | null = null,
  ): void {
    const reason: UnfinishedReason = failed ? 'failed' : 'aborted';
    const durationMs = elapsedSince(startedAt);
    const tokens = usage
      ? `tokens: ${usage.inputTokens} in (${usage.cachedInputTokens} cached) + ${usage.outputTokens} out`
      : 'tokens: unknown';
    this.logger.warn(
      `${provider ?? 'no provider'} ${label} step ${step} ${reason} after ${durationMs}ms, ${tokens}`,
    );
    const record: ModelCallRecord = {
      prompt: label,
      provider: provider ?? 'none',
      modelId: 'unknown',
      step,
      durationMs,
      usage,
      finishReason: reason,
    };
    recordModelCall(record);
  }
}

/** `at 1450ms, 12ms after the step before; model 830ms, first output after 300ms; tools 40ms`. */
function describeTiming({ startedAtMs, gapMs, performance: perf }: StepTiming): string {
  const parts = [
    `at ${startedAtMs}ms${gapMs === null ? '' : `, ${gapMs}ms after the step before`}`,
  ];
  const firstOutput =
    perf.timeToFirstOutputMs === undefined
      ? ''
      : `, first output after ${Math.round(perf.timeToFirstOutputMs)}ms`;
  parts.push(`model ${Math.round(perf.responseTimeMs)}ms${firstOutput}`);
  const toolsMs = Object.values(perf.toolExecutionMs).reduce((sum, ms) => sum + ms, 0);
  if (toolsMs > 0 || Object.keys(perf.toolExecutionMs).length > 0) {
    parts.push(`tools ${Math.round(toolsMs)}ms`);
  }
  return parts.join('; ');
}
