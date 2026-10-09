import { HttpStatus } from '@nestjs/common';

/**
 * Base for every application exception. The status the client receives is a property of the
 * exception itself, so `AllExceptionsFilter` needs no registry - extend one of the bases below.
 */
export abstract class AppError extends Error {
  public abstract readonly status: HttpStatus;
}

export class BadRequestError extends AppError {
  public readonly status = HttpStatus.BAD_REQUEST;
}

export class UnauthorizedError extends AppError {
  public readonly status = HttpStatus.UNAUTHORIZED;
}

export class ForbiddenError extends AppError {
  public readonly status = HttpStatus.FORBIDDEN;
}

export class NotFoundError extends AppError {
  public readonly status = HttpStatus.NOT_FOUND;
}

export class ConflictError extends AppError {
  public readonly status = HttpStatus.CONFLICT;
}

export class TooManyRequestsError extends AppError {
  public readonly status = HttpStatus.TOO_MANY_REQUESTS;
}
