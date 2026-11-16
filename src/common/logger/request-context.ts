import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { ModelCallRecord } from '../types/model';

/** Accepted from the caller (web app, proxy) and echoed back on every response. */
export const REQUEST_ID_HEADER = 'x-request-id';

const MAX_REQUEST_ID_LENGTH = 128;

interface RequestContext {
  requestId: string;
  /** Every model response of the request, in order (`recordModelCall`). */
  modelCalls: ModelCallRecord[];
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The caller's id when it sent a usable one, a fresh uuid otherwise. */
export function resolveRequestId(inbound: unknown): string {
  const id = typeof inbound === 'string' ? inbound.trim().slice(0, MAX_REQUEST_ID_LENGTH) : '';
  return id || randomUUID();
}

/** Everything awaited inside `callback` (guards, pipes, handler, filters) sees `requestId`. */
export function runWithRequestId<T>(requestId: string, callback: () => T): T {
  return storage.run({ requestId, modelCalls: [] }, callback);
}

/** Undefined outside a request (bootstrap, scripts). */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Adds a model response to the current request; outside a request (scripts, evals) does nothing. */
export function recordModelCall(call: ModelCallRecord): void {
  storage.getStore()?.modelCalls.push(call);
}

/** The model responses of the current request so far; none outside a request. */
export function getModelCalls(): readonly ModelCallRecord[] {
  return [...(storage.getStore()?.modelCalls ?? [])];
}
