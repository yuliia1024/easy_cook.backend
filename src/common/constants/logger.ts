import { LogLevel } from '@nestjs/common';

/** Most to least severe; `LOG_LEVEL` enables its level and everything before it. */
export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'log',
  'debug',
  'verbose',
] as const satisfies readonly LogLevel[];

export const DEFAULT_LOG_LEVEL: LogLevel = 'log';

/** A step of the trace of one chat message (`ChatTrace`), in the order they happen. */
export enum ChatTraceStep {
  Context = 'context',
  Intent = 'intent',
  MenuRequest = 'menu_request',
  Route = 'route',
  ToolCall = 'tool_call',
  ServiceCall = 'service_call',
  MenuPlan = 'menu_plan',
  Event = 'event',
  Saved = 'saved',
  Error = 'error',
}

export enum ChatTraceOutcome {
  Replied = 'replied',
  /** Ended with an `error` event: nothing was saved. */
  Failed = 'failed',
  /** The client went away. */
  Aborted = 'aborted',
  LimitReached = 'limit_reached',
}
