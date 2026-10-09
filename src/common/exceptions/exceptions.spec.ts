import { HttpStatus } from '@nestjs/common';
import * as badRequest from './bad-request';
import * as conflict from './conflict';
import * as forbidden from './forbidden';
import * as notFound from './not-found';
import * as tooManyRequests from './too-many-requests';
import * as unauthorized from './unauthorized';
import { AppError } from './app-error';

/**
 * Every exception must extend the base matching the file it lives in, otherwise the filter
 * would answer with the wrong status (or a 500 for a bare `Error`).
 */
describe('exception taxonomy', () => {
  const groups: Array<[string, Record<string, unknown>, HttpStatus]> = [
    ['bad-request', badRequest, HttpStatus.BAD_REQUEST],
    ['unauthorized', unauthorized, HttpStatus.UNAUTHORIZED],
    ['forbidden', forbidden, HttpStatus.FORBIDDEN],
    ['not-found', notFound, HttpStatus.NOT_FOUND],
    ['conflict', conflict, HttpStatus.CONFLICT],
    ['too-many-requests', tooManyRequests, HttpStatus.TOO_MANY_REQUESTS],
  ];

  const cases = groups.flatMap(([file, exports, status]) =>
    Object.entries(exports).map(([name, ctor]) => [file, name, ctor, status] as const),
  );

  it.each(cases)('%s: %s', (_file, _name, ctor, status) => {
    const error = new (ctor as new (...args: unknown[]) => AppError)(30);

    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(status);
    expect(error.message).toBeTruthy();
  });

  it('puts the retry delay into the cooldown message', () => {
    expect(new tooManyRequests.OtpCooldownTooManyRequestsException(42).message).toContain(
      '42 seconds',
    );
  });
});
