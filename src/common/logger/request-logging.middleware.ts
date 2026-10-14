import { HttpStatus, Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { REQUEST_ID_HEADER, resolveRequestId, runWithRequestId } from './request-context';

/** Probes and docs would drown the requests anyone actually debugs. */
const IGNORED_PATHS = /^\/(api\/health|docs)(\/|$)/;

const logger = new Logger('HTTP');

/**
 * Opens the request context and logs one line per request once the response is sent:
 * `GET /api/menus/1 200 12ms`. Runs before routing, so 404s and validation errors are traced too.
 */
export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
  const startedAt = performance.now();
  const url = req.originalUrl || req.url;

  res.setHeader(REQUEST_ID_HEADER, requestId);

  if (!IGNORED_PATHS.test(url.split('?')[0])) {
    res.on('finish', () => {
      const line = `${req.method} ${url} ${res.statusCode} ${Math.round(performance.now() - startedAt)}ms`;
      runWithRequestId(requestId, () => {
        if (res.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
          logger.error(line);
        } else if (res.statusCode >= HttpStatus.BAD_REQUEST) {
          logger.warn(line);
        } else {
          logger.log(line);
        }
      });
    });
  }

  runWithRequestId(requestId, next);
}
