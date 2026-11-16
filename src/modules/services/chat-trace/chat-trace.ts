import { ChatTraceOutcome, ChatTraceStep } from '../../../common/constants';
import { ModelCallRecord, ModelUsage } from '../../../common/types';
import { ChatToolCall } from '../chat-tools/chat-tool-registry';

export interface ChatTraceEntry {
  step: ChatTraceStep;
  /** Since the message came in. */
  atMs: number;
  data: unknown;
}

/**
 * What one chat message cost, logged in every environment: time, the first text, the model calls
 * and the tokens summed over all of them (intent, chat steps, menu plan, summary), the tool calls.
 */
export interface ChatReplySummary {
  outcome: ChatTraceOutcome;
  durationMs: number;
  /** Since the message came in; null when no text was sent. */
  firstTextMs: number | null;
  modelCalls: number;
  /** Aborted or failed before the provider reported the tokens: not in `usage`. */
  unfinishedModelCalls: number;
  usage: ModelUsage;
  toolCalls: number;
  failedToolCalls: number;
}

/** The whole chain of one chat message, as it is logged. */
export interface ChatTraceRecord {
  conversationId: string;
  /** What the client sent. */
  request: { content: string };
  outcome: ChatTraceOutcome;
  durationMs: number;
  summary: ChatReplySummary;
  /** Every model response, one per step of a tool loop. */
  modelCalls: ModelCallRecord[];
  steps: ChatTraceEntry[];
}

const sinceMs = (startedAt: number): number => Math.round(performance.now() - startedAt);

/**
 * The steps of one chat message, from what the client sent to the saved reply: the context the
 * models read, the intent, the menu request, every tool call with its arguments and result, the
 * plan and the events sent. A disabled trace records no steps, so it costs nothing outside `local`;
 * the counts of the summary (time, first text, tool calls) it keeps always.
 */
export class ChatTrace {
  private readonly startedAt = performance.now();
  private readonly steps: ChatTraceEntry[] = [];
  private firstTextMs: number | null = null;
  private toolCalls = 0;
  private failedToolCalls = 0;

  constructor(
    public readonly enabled: boolean,
    public readonly conversationId: string,
    private readonly content: string,
  ) {}

  public add(step: ChatTraceStep, data: unknown): void {
    if (this.enabled) {
      this.steps.push({ step, atMs: sinceMs(this.startedAt), data });
    }
  }

  /** The first call marks when the user saw the first text of the reply. */
  public textSent(): void {
    this.firstTextMs ??= sinceMs(this.startedAt);
  }

  public addToolCall(call: ChatToolCall): void {
    this.toolCalls += 1;
    if (call.error) {
      this.failedToolCalls += 1;
    }
    this.add(ChatTraceStep.ToolCall, call);
  }

  /** An error as plain data; the stack only in the trace, never to the client. */
  public addError(error: unknown): void {
    this.add(
      ChatTraceStep.Error,
      error instanceof Error
        ? { name: error.constructor.name, message: error.message, stack: error.stack }
        : { message: String(error) },
    );
  }

  public summarize(
    outcome: ChatTraceOutcome,
    modelCalls: readonly ModelCallRecord[],
  ): ChatReplySummary {
    const usage: ModelUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    let unfinishedModelCalls = 0;
    for (const call of modelCalls) {
      if (!call.usage) {
        unfinishedModelCalls += 1;
        continue;
      }
      usage.inputTokens += call.usage.inputTokens;
      usage.cachedInputTokens += call.usage.cachedInputTokens;
      usage.outputTokens += call.usage.outputTokens;
    }
    return {
      outcome,
      durationMs: sinceMs(this.startedAt),
      firstTextMs: this.firstTextMs,
      modelCalls: modelCalls.length,
      unfinishedModelCalls,
      usage,
      toolCalls: this.toolCalls,
      failedToolCalls: this.failedToolCalls,
    };
  }

  public toRecord(
    outcome: ChatTraceOutcome,
    modelCalls: readonly ModelCallRecord[] = [],
  ): ChatTraceRecord {
    const summary = this.summarize(outcome, modelCalls);
    return {
      conversationId: this.conversationId,
      request: { content: this.content },
      outcome,
      durationMs: summary.durationMs,
      summary,
      modelCalls: [...modelCalls],
      steps: [...this.steps],
    };
  }
}

/**
 * `Chat reply replied in 5230ms, first text after 1200ms: 4 model calls (1 unfinished), tokens
 * 5400 in (1200 cached) + 320 out; 2 tool calls (1 failed)`.
 */
export function describeSummary(summary: ChatReplySummary): string {
  const { usage } = summary;
  const firstText =
    summary.firstTextMs === null ? 'no text' : `first text after ${summary.firstTextMs}ms`;
  const unfinished =
    summary.unfinishedModelCalls > 0 ? ` (${summary.unfinishedModelCalls} unfinished)` : '';
  const failedTools = summary.failedToolCalls > 0 ? ` (${summary.failedToolCalls} failed)` : '';
  return (
    `Chat reply ${summary.outcome} in ${summary.durationMs}ms, ${firstText}: ` +
    `${summary.modelCalls} model calls${unfinished}, tokens ${usage.inputTokens} in ` +
    `(${usage.cachedInputTokens} cached) + ${usage.outputTokens} out; ` +
    `${summary.toolCalls} tool calls${failedTools}`
  );
}
