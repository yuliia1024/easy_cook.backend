import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client';
import { AppError } from './app-error';

/**
 * Constraint violations the services check up front but can still hit in a race (two requests
 * creating the same row, a row deleted between the check and the write).
 */
const PRISMA_ERRORS: Record<string, { status: HttpStatus; message: string }> = {
  P2002: { status: HttpStatus.CONFLICT, message: 'This record already exists' },
  P2003: { status: HttpStatus.CONFLICT, message: 'A related record is missing or still in use' },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'The record no longer exists' },
};

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
  timestamp: string;
}

/**
 * Single place that turns any thrown value into a response. `AppError`s carry their own status,
 * Nest `HttpException`s (validation pipe, throttler) keep theirs, known Prisma constraint errors
 * become 404/409, everything else is a 500 that is logged with its stack and never leaks details
 * to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, message } = this.resolve(exception);
    // `url` is relative to the router that answered (e.g. without the global prefix).
    const path = request.originalUrl ?? request.url;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${path} failed`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorBody = {
      statusCode: status,
      message,
      error: HttpStatus[status] ?? 'Error',
      path,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(body);
  }

  private resolve(exception: unknown): { status: number; message: string | string[] } {
    if (exception instanceof AppError) {
      return { status: exception.status, message: exception.message };
    }

    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const message =
        typeof res === 'object' && res !== null && 'message' in res
          ? (res as { message: string | string[] }).message
          : exception.message;
      return { status: exception.getStatus(), message };
    }

    if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code in PRISMA_ERRORS
    ) {
      return PRISMA_ERRORS[exception.code];
    }

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' };
  }
}
