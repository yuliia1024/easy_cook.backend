import { fakeConfig } from '../../test/fake-config';
import { AuthJwtConfigService } from './auth-jwt-config.service';

describe('AuthJwtConfigService', () => {
  const service = new AuthJwtConfigService(
    fakeConfig({
      AUTH_JWT_SECRET: 'a',
      AUTH_JWT_EXPIRES_IN_SEC: '900',
      AUTH_JWT_REFRESH_SECRET: 'r',
      AUTH_JWT_REFRESH_EXPIRES_IN_SEC: '86400',
    }),
  );

  it('returns the access token settings', () => {
    expect(service.access()).toEqual({ secret: 'a', expiresInSec: 900 });
  });

  it('returns the refresh token settings', () => {
    expect(service.refresh()).toEqual({ secret: 'r', expiresInSec: 86400 });
  });
});
