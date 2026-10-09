import { Environments } from '../../common/types';
import { fakeConfig } from '../../test/fake-config';
import { ApiConfigService } from './api-config.service';

describe('ApiConfigService', () => {
  const build = (values: Parameters<typeof fakeConfig>[0]): ApiConfigService =>
    new ApiConfigService(fakeConfig(values));

  it('exposes port, env and front-end url', () => {
    const service = build({ PORT: '3100', ENV: Environments.LOCAL, FRONT_END_URL: 'http://app' });

    expect(service.port).toBe(3100);
    expect(service.env).toBe(Environments.LOCAL);
    expect(service.frontEndUrl).toBe('http://app');
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

  describe('cors', () => {
    it('reflects any origin for "*"', () => {
      expect(build({ CORS_ORIGINS: '*' }).cors()).toEqual({ origin: true, credentials: true });
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
