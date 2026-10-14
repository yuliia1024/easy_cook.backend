import { Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { Request, Response } from 'express';
import { getRequestId } from './request-context';
import { requestLoggingMiddleware } from './request-logging.middleware';

describe('requestLoggingMiddleware', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  const run = (
    url: string,
    headers: Record<string, string> = {},
  ): { res: Response & EventEmitter; idInNext: string | undefined } => {
    const req = { method: 'GET', originalUrl: url, url, headers } as unknown as Request;
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      setHeader: jest.fn(),
    }) as unknown as Response & EventEmitter;
    let idInNext: string | undefined;

    requestLoggingMiddleware(req, res, () => {
      idInNext = getRequestId();
    });

    return { res, idInNext };
  };

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  it('reuses the caller id, echoes it and runs the rest of the chain inside it', () => {
    const { res, idInNext } = run('/api/menus', { 'x-request-id': 'req-1' });

    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'req-1');
    expect(idInNext).toBe('req-1');
  });

  it('generates an id when the caller sent none', () => {
    const { res, idInNext } = run('/api/menus');

    expect(idInNext).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', idInNext);
  });

  it('logs method, url, status and duration once the response is sent', () => {
    const { res } = run('/api/menus?page=2');

    expect(log).not.toHaveBeenCalled();
    res.emit('finish');

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^GET \/api\/menus\?page=2 200 \d+ms$/));
  });

  it.each([
    [404, () => warn],
    [500, () => error],
  ])('logs a %i at its level', (status, spy) => {
    const { res } = run('/api/menus');
    res.statusCode = status;
    res.emit('finish');

    expect(spy()).toHaveBeenCalledWith(expect.stringContaining(`GET /api/menus ${status}`));
  });

  it.each(['/api/health', '/docs', '/docs/swagger.json'])('does not log %s', (url) => {
    const { res, idInNext } = run(url);
    res.emit('finish');

    expect(idInNext).toBeDefined();
    expect(log).not.toHaveBeenCalled();
  });
});
