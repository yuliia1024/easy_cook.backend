import { Environments } from '../../common/types';
import { fakeConfig } from '../../test/fake-config';
import { ApiConfigService } from './api-config.service';

describe('ApiConfigService', () => {
  const build = (values: Parameters<typeof fakeConfig>[0]): ApiConfigService =>
    new ApiConfigService(fakeConfig(values));

  it('exposes port and env', () => {
    const service = build({ PORT: '3100', ENV: Environments.LOCAL });

    expect(service.port).toBe(3100);
    expect(service.env).toBe(Environments.LOCAL);
  });

  describe('isSwaggerEnabled', () => {
    it('is on when enabled outside production', () => {
      expect(build({ SWAGGER_ENABLED: 'true', ENV: Environments.STAGING }).isSwaggerEnabled).toBe(
        true,
      );
    });

    it('is always off on production', () => {
      expect(
        build({ SWAGGER_ENABLED: 'true', ENV: Environments.PRODUCTION }).isSwaggerEnabled,
      ).toBe(false);
    });

    it('is off unless enabled', () => {
      expect(build({ ENV: Environments.LOCAL }).isSwaggerEnabled).toBe(false);
    });
  });

  describe('logLevels', () => {
    it('defaults to log and everything more severe', () => {
      expect(build({}).logLevels).toEqual(['fatal', 'error', 'warn', 'log']);
    });

    it('enables the configured level and the ones above it', () => {
      expect(build({ LOG_LEVEL: 'warn' }).logLevels).toEqual(['fatal', 'error', 'warn']);
      expect(build({ LOG_LEVEL: 'debug' }).logLevels).toEqual([
        'fatal',
        'error',
        'warn',
        'log',
        'debug',
      ]);
    });
  });

  it('trusts no proxy unless configured', () => {
    expect(build({}).trustProxyHops).toBe(0);
    expect(build({ TRUST_PROXY_HOPS: '1' }).trustProxyHops).toBe(1);
  });

  describe('isOriginAllowed', () => {
    it('allows only local origins for "*" or unset', () => {
      for (const service of [build({ CORS_ORIGINS: '*' }), build({})]) {
        expect(service.isOriginAllowed('http://localhost:5173')).toBe(true);
        expect(service.isOriginAllowed('http://127.0.0.1:3100')).toBe(true);
        expect(service.isOriginAllowed('https://evil.example.com')).toBe(false);
        expect(service.isOriginAllowed('http://localhost.evil.com')).toBe(false);
        expect(service.isOriginAllowed('null')).toBe(false);
      }
    });

    it('allows exactly the listed origins', () => {
      const service = build({ CORS_ORIGINS: 'https://a.com, https://b.com' });

      expect(service.isOriginAllowed('https://b.com')).toBe(true);
      expect(service.isOriginAllowed('https://a.com.evil.com')).toBe(false);
      expect(service.isOriginAllowed('http://a.com')).toBe(false);
      expect(service.isOriginAllowed('http://localhost:5173')).toBe(false);
    });
  });

  describe('cors', () => {
    const allows = (options: ReturnType<ApiConfigService['cors']>, origin?: string): boolean => {
      let allowed = false;
      (
        options.origin as (o: string | undefined, cb: (e: Error | null, a: boolean) => void) => void
      )(origin, (_error, result) => {
        allowed = result;
      });
      return allowed;
    };

    it('sends credentials, the CSRF header, the request id and the retry times of the limits', () => {
      expect(build({}).cors()).toMatchObject({
        credentials: true,
        allowedHeaders: ['content-type', 'x-csrf-token', 'x-request-id'],
        exposedHeaders: ['x-request-id', 'retry-after', 'retry-after-sign_in', 'retry-after-llm'],
        maxAge: 600,
      });
    });

    it('answers only allowed origins, and requests without one', () => {
      const options = build({ CORS_ORIGINS: 'https://a.com' }).cors();

      expect(allows(options, 'https://a.com')).toBe(true);
      expect(allows(options, 'https://evil.com')).toBe(false);
      expect(allows(options, undefined)).toBe(true);
    });
  });
});
