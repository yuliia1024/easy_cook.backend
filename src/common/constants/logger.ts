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
