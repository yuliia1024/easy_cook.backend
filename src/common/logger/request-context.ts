import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** Accepted from the caller (web app, proxy) and echoed back on every response. */
export const REQUEST_ID_HEADER = 'x-request-id';

const MAX_REQUEST_ID_LENGTH = 128;

const storage = new AsyncLocalStorage<{ requestId: string }>();

/** The caller's id when it sent a usable one, a fresh uuid otherwise. */
export function resolveRequestId(inbound: unknown): string {
  const id = typeof inbound === 'string' ? inbound.trim().slice(0, MAX_REQUEST_ID_LENGTH) : '';
  return id || randomUUID();
}

/** Everything awaited inside `callback` (guards, pipes, handler, filters) sees `requestId`. */
export function runWithRequestId<T>(requestId: string, callback: () => T): T {
  return storage.run({ requestId }, callback);
}

/** Undefined outside a request (bootstrap, scripts). */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
