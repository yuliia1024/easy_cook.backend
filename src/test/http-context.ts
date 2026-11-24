import { ExecutionContext } from '@nestjs/common';

/** An `ExecutionContext` of an HTTP request, for guard and decorator specs. */
export function httpContext(
  request: Record<string, unknown>,
  handler: () => void = () => undefined,
  classRef: object = class {},
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    getHandler: () => handler,
    getClass: () => classRef,
  } as unknown as ExecutionContext;
}
