import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai';
import { Injectable, Logger } from '@nestjs/common';
import { FinishReason, LanguageModelUsage, ModelMessage, streamText } from 'ai';
import { MAX_OUTPUT_TOKENS, OPEN_AI_INSTRUCTIONS, OPEN_AI_MODEL } from '../../common/constants';
import { OpenAiConfigService } from '../../configs/open-ai-config/open-ai-config.service';

interface StepSummary {
  modelId: string;
  responseId: string;
  finishReason: FinishReason;
  rawFinishReason: string | undefined;
  usage: LanguageModelUsage;
}

@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);
  private readonly provider: OpenAIProvider;

  constructor(openAiConfig: OpenAiConfigService) {
    this.provider = createOpenAI({ apiKey: openAiConfig.apiKey });
  }

  /**
   * Streams text generation (AI SDK `streamText`, OpenAI Responses API); yields the model's text
   * deltas. `input` is a single prompt or a conversation, oldest message first. A failed call
   * throws from the generator.
   */
  public async *streamText(input: string | ModelMessage[]): AsyncGenerator<string> {
    const startedAt = Date.now();
    let firstDeltaAt: number | null = null;
    const result = streamText({
      model: this.provider.responses(OPEN_AI_MODEL),
      system: OPEN_AI_INSTRUCTIONS,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      ...(typeof input === 'string' ? { prompt: input } : { messages: input }),
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
  }

  /** Model, outcome, timings and token usage of a finished response. */
  private logSummary(step: StepSummary, startedAt: number, firstDeltaAt: number | null): void {
    const { usage } = step;
    const tokens =
      usage.totalTokens === undefined
        ? 'tokens: unknown'
        : `tokens: ${usage.inputTokens} in (${usage.inputTokenDetails.cacheReadTokens ?? 0} cached)` +
          ` + ${usage.outputTokens} out (${usage.outputTokenDetails.reasoningTokens ?? 0} reasoning)` +
          ` = ${usage.totalTokens}`;
    const firstDelta = firstDeltaAt === null ? 'none' : `${firstDeltaAt - startedAt}ms`;
    const summary =
      `${step.modelId} ${step.responseId} ${step.finishReason} in ${Date.now() - startedAt}ms` +
      ` (first text after ${firstDelta}), ${tokens}`;

    if (step.finishReason === 'stop') {
      this.logger.log(summary);
    } else {
      this.logger.warn(`${summary}; reason: ${step.rawFinishReason ?? step.finishReason}`);
    }
  }
}
