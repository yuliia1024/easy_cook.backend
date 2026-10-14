import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type { Response, ResponseInput } from 'openai/resources/responses/responses';
import { MAX_OUTPUT_TOKENS, OPEN_AI_INSTRUCTIONS, OPEN_AI_MODEL } from '../../common/constants';
import { OpenAiConfigService } from '../../configs/open-ai-config/open-ai-config.service';

@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);
  private readonly client: OpenAI;

  constructor(openAiConfig: OpenAiConfigService) {
    this.client = new OpenAI({ apiKey: openAiConfig.apiKey });
  }

  /**
   * Streams text generation through the Responses API; yields the model's text deltas. `input` is
   * a single prompt or a conversation, oldest message first.
   */
  public async *streamText(input: string | ResponseInput): AsyncGenerator<string> {
    const startedAt = Date.now();
    let firstDeltaAt: number | null = null;
    const stream = await this.client.responses.create({
      model: OPEN_AI_MODEL,
      instructions: OPEN_AI_INSTRUCTIONS,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      input,
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        firstDeltaAt ??= Date.now();
        yield event.delta;
      } else if (
        event.type === 'response.completed' ||
        event.type === 'response.incomplete' ||
        event.type === 'response.failed'
      ) {
        this.logSummary(event.response, startedAt, firstDeltaAt);
      }
    }
  }

  /** Model, outcome, timings and token usage of a finished response. */
  private logSummary(response: Response, startedAt: number, firstDeltaAt: number | null): void {
    const { usage } = response;
    const tokens = usage
      ? `tokens: ${usage.input_tokens} in (${usage.input_tokens_details.cached_tokens} cached)` +
        ` + ${usage.output_tokens} out (${usage.output_tokens_details.reasoning_tokens} reasoning)` +
        ` = ${usage.total_tokens}`
      : 'tokens: unknown';
    const firstDelta = firstDeltaAt === null ? 'none' : `${firstDeltaAt - startedAt}ms`;
    const summary =
      `${response.model} ${response.id} ${response.status} in ${Date.now() - startedAt}ms` +
      ` (first text after ${firstDelta}), ${tokens}`;

    if (response.status === 'completed') {
      this.logger.log(summary);
    } else {
      const reason = response.error?.message ?? response.incomplete_details?.reason ?? 'unknown';
      this.logger.warn(`${summary}; reason: ${reason}`);
    }
  }
}
