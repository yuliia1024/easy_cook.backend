import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { FoodItemSourceConflictException } from './conflict';
import { RecipeNotFoundException } from './not-found';
import { DatabaseUnavailableException } from './service-unavailable';

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
        getRequest: () => ({ method: 'POST', url: '/foods', originalUrl: '/api/foods' }),
      }),
    } as unknown as ArgumentsHost;
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  const body = (): Record<string, unknown> => response.json.mock.calls[0][0];

  it('answers an AppError with its own status and message', () => {
    filter.catch(new FoodItemSourceConflictException(), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(body()).toMatchObject({
      statusCode: 409,
      message: 'A food item with this source and source id already exists',
      error: 'CONFLICT',
      path: '/api/foods',
    });
    expect(typeof body().timestamp).toBe('string');
    expect(logError).not.toHaveBeenCalled();
  });

  it('keeps the validation messages of a Nest HttpException', () => {
    filter.catch(new BadRequestException(['name should not be empty']), host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(body().message).toEqual(['name should not be empty']);
  });

  it.each([
    ['P2002', 409],
    ['P2003', 409],
    ['P2025', 404],
  ])('maps the Prisma error %s to %d without logging', (code, status) => {
    filter.catch(
      new Prisma.PrismaClientKnownRequestError('constraint', { code, clientVersion: 'test' }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(status);
    expect(body().message).not.toContain('constraint');
    expect(logError).not.toHaveBeenCalled();
  });

  it('keeps other Prisma errors a logged 500', () => {
    filter.catch(
      new Prisma.PrismaClientKnownRequestError('boom', { code: 'P2000', clientVersion: 'test' }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(logError).toHaveBeenCalled();
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
      'POST /api/foods failed',
      expect.stringContaining('hunter2'),
    );
  });

  it('copes with a thrown non-Error value', () => {
    filter.catch('boom', host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(logError).toHaveBeenCalledWith(expect.any(String), 'boom');
  });

  it('logs a 503 but keeps its message', () => {
    filter.catch(new DatabaseUnavailableException(), host);

    expect(body()).toMatchObject({ statusCode: 503, message: 'Database is unavailable' });
    expect(logError).toHaveBeenCalled();
  });

  it('falls back to url when there is no originalUrl', () => {
    host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ method: 'GET', url: '/api/x' }),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(new RecipeNotFoundException(), host);

    expect(body().path).toBe('/api/x');
  });

  it('does not log expected 4xx errors', () => {
    filter.catch(new RecipeNotFoundException(), host);

    expect(logError).not.toHaveBeenCalled();
  });
});
