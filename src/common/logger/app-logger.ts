import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { getRequestId } from './request-context';

type JsonLogOptions = {
  context: string;
  logLevel: LogLevel;
  writeStreamType?: 'stdout' | 'stderr';
  errorStack?: unknown;
  params?: Record<string, unknown>;
  error?: Error;
};

/**
 * Nest's console logger that stamps the current request id on every entry, so all lines of one
 * request can be found by the `x-request-id` the client got back. Call sites keep using
 * `new Logger(Context)`.
 */
export class AppLogger extends ConsoleLogger {
  protected formatContext(context: string): string {
    const requestId = getRequestId();
    const formatted = super.formatContext(context);
    return requestId ? `${formatted}[req ${requestId}] ` : formatted;
  }

  protected getJsonLogObject(
    message: unknown,
    options: JsonLogOptions,
  ): ReturnType<ConsoleLogger['getJsonLogObject']> {
    const logObject = super.getJsonLogObject(message, options);
    const requestId = getRequestId();
    return requestId ? { ...logObject, requestId } : logObject;
  }
}
