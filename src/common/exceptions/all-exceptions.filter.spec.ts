import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { EmailExistConflictException } from './conflict';
import { UnauthorizedException } from './unauthorized';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let response: { status: jest.Mock; json: jest.Mock };
  let host: ArgumentsHost;
  let logError: jest.SpyInstance;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    response = { status: jest.fn(), json: jest.fn() };
    response.status.mockReturnValue(response);
    host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ method: 'POST', url: '/api/auth/sign-in' }),
      }),
    } as unknown as ArgumentsHost;
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  const body = (): Record<string, unknown> => response.json.mock.calls[0][0];

  it('answers an AppError with its own status and message', () => {
    filter.catch(new EmailExistConflictException(), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(body()).toMatchObject({
      statusCode: 409,
      message: 'Email is already registered',
      error: 'CONFLICT',
      path: '/api/auth/sign-in',
    });
    expect(typeof body().timestamp).toBe('string');
    expect(logError).not.toHaveBeenCalled();
  });

  it('keeps the validation messages of a Nest HttpException', () => {
    filter.catch(new BadRequestException(['email must be an email']), host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(body().message).toEqual(['email must be an email']);
  });

  it('falls back to the exception message for a string response', () => {
    filter.catch(new NotFoundException('nope'), host);

    expect(body()).toMatchObject({ statusCode: 404, message: 'nope' });
  });

  it('hides unknown errors behind a 500 and logs them', () => {
    filter.catch(new Error('db password is hunter2'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(body().message).toBe('Internal server error');
    expect(logError).toHaveBeenCalledWith(
      'POST /api/auth/sign-in failed',
      expect.stringContaining('hunter2'),
    );
  });

  it('copes with a thrown non-Error value', () => {
    filter.catch('boom', host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(logError).toHaveBeenCalledWith(expect.any(String), 'boom');
  });

  it('does not log expected 4xx errors', () => {
    filter.catch(new UnauthorizedException(), host);

    expect(logError).not.toHaveBeenCalled();
  });
});
