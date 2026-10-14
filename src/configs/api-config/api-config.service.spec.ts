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

  describe('cors', () => {
    it('reflects any origin for "*"', () => {
      expect(build({ CORS_ORIGINS: '*' }).cors()).toEqual({
        origin: true,
        credentials: true,
        exposedHeaders: ['x-request-id'],
      });
    });

    it('defaults to any origin when unset', () => {
      expect(build({}).cors().origin).toBe(true);
    });

    it('splits and trims a comma separated list', () => {
      expect(build({ CORS_ORIGINS: 'http://a.com, http://b.com' }).cors().origin).toEqual([
        'http://a.com',
        'http://b.com',
      ]);
    });
  });
});
