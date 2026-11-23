import {
  JsonBodyRequiredUnsupportedMediaTypeException,
  OriginNotAllowedForbiddenException,
} from '../../../common/exceptions';
import { ApiConfigService } from '../../../configs/api-config/api-config.service';
import { httpContext } from '../../../test/http-context';
import { RequestOriginGuard } from './request-origin.guard';

describe('RequestOriginGuard', () => {
  const guard = new RequestOriginGuard({
    isOriginAllowed: (origin: string) => origin === 'https://app.example.com',
  } as unknown as ApiConfigService);
  const request = (
    method: string,
    headers: Record<string, string>,
    contentType?: string,
  ): Record<string, unknown> => ({
    method,
    headers,
    is: (type: string) => (contentType === type ? type : false),
  });
  const json = { 'content-length': '12' };

  it('lets every safe request through', () => {
    expect(guard.canActivate(httpContext(request('GET', { origin: 'https://evil.com' })))).toBe(
      true,
    );
  });

  it('lets a JSON request of an allowed origin through', () => {
    const context = httpContext(
      request('POST', { origin: 'https://app.example.com', ...json }, 'application/json'),
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('refuses an unsafe request of another origin', () => {
    const context = httpContext(request('DELETE', { origin: 'https://evil.com' }));

    expect(() => guard.canActivate(context)).toThrow(OriginNotAllowedForbiddenException);
  });

  it('refuses a cross-site request that sent no origin, but not a non-browser one', () => {
    expect(() =>
      guard.canActivate(httpContext(request('POST', { 'sec-fetch-site': 'cross-site' }))),
    ).toThrow(OriginNotAllowedForbiddenException);
    expect(guard.canActivate(httpContext(request('POST', {})))).toBe(true);
  });

  it.each([
    ['a form', 'application/x-www-form-urlencoded', json],
    ['plain text', 'text/plain', json],
    ['a chunked body', 'text/plain', { 'transfer-encoding': 'chunked' }],
  ])('refuses %s as the body (415)', (_case, contentType, headers) => {
    const context = httpContext(
      request('POST', { origin: 'https://app.example.com', ...headers }, contentType),
    );

    expect(() => guard.canActivate(context)).toThrow(JsonBodyRequiredUnsupportedMediaTypeException);
  });

  it('lets an unsafe request without a body through', () => {
    const context = httpContext(
      request('POST', { origin: 'https://app.example.com', 'content-length': '0' }),
    );

    expect(guard.canActivate(context)).toBe(true);
  });
});
