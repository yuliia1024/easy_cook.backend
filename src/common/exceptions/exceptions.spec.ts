import { HttpStatus } from '@nestjs/common';
import * as badRequest from './bad-request';
import * as conflict from './conflict';
import * as notFound from './not-found';
import * as serviceUnavailable from './service-unavailable';
import { AppError } from './app-error';

/** Constructor arguments for the exceptions that need them. */
const ARGS: Record<string, unknown[]> = {
  FoodItemsNotFoundBadRequestException: [['a', 'b']],
  UnknownDietBadRequestException: ['carnivore'],
};

/**
 * Every exception must extend the base matching the file it lives in, otherwise the filter
 * would answer with the wrong status (or a 500 for a bare `Error`).
 */
describe('exception taxonomy', () => {
  const groups: Array<[string, Record<string, unknown>, HttpStatus]> = [
    ['bad-request', badRequest, HttpStatus.BAD_REQUEST],
    ['not-found', notFound, HttpStatus.NOT_FOUND],
    ['conflict', conflict, HttpStatus.CONFLICT],
    ['service-unavailable', serviceUnavailable, HttpStatus.SERVICE_UNAVAILABLE],
  ];

  const cases = groups.flatMap(([file, exports, status]) =>
    Object.entries(exports).map(([name, ctor]) => [file, name, ctor, status] as const),
  );

  it.each(cases)('%s: %s', (_file, name, ctor, status) => {
    const error = new (ctor as new (...args: unknown[]) => AppError)(...(ARGS[name] ?? []));

    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(status);
    expect(error.message).toBeTruthy();
  });

  it('lists the missing food ids', () => {
    expect(new badRequest.FoodItemsNotFoundBadRequestException(['x', 'y']).message).toBe(
      'Food items not found: x, y',
    );
  });

  it('names the unknown diet', () => {
    expect(new badRequest.UnknownDietBadRequestException('carnivore').message).toContain(
      'carnivore',
    );
  });
});
