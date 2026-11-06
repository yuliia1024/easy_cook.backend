import { ChatTraceOutcome, ChatTraceStep } from '../../../common/constants';

export interface ChatTraceEntry {
  step: ChatTraceStep;
  /** Since the message came in. */
  atMs: number;
  data: unknown;
}

/** The whole chain of one chat message, as it is logged. */
export interface ChatTraceRecord {
  conversationId: string;
  /** What the client sent. */
  request: { content: string };
  outcome: ChatTraceOutcome;
  durationMs: number;
  steps: ChatTraceEntry[];
}

/**
 * The steps of one chat message, from what the client sent to the saved reply: the context the
 * models read, the intent, the menu request, every tool call with its arguments and result, the
 * plan and the events sent. A disabled trace records nothing, so it costs nothing outside `local`.
 */
export class ChatTrace {
  private readonly startedAt = Date.now();
  private readonly steps: ChatTraceEntry[] = [];

  constructor(
    public readonly enabled: boolean,
    public readonly conversationId: string,
    private readonly content: string,
  ) {}

  public add(step: ChatTraceStep, data: unknown): void {
    if (this.enabled) {
      this.steps.push({ step, atMs: Date.now() - this.startedAt, data });
    }
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

  public toRecord(outcome: ChatTraceOutcome): ChatTraceRecord {
    return {
      conversationId: this.conversationId,
      request: { content: this.content },
      outcome,
      durationMs: Date.now() - this.startedAt,
      steps: [...this.steps],
    };
  }
}
