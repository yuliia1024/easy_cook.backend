import { CookieSameSite, SESSION_ABSOLUTE_TTL_SECONDS } from '../../common/constants';
import { fakeConfig } from '../../test/fake-config';
import { AuthConfigService } from './auth-config.service';

describe('AuthConfigService', () => {
  it('exposes the Google client id and the secret', () => {
    const config = new AuthConfigService(
      fakeConfig({
        GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
        AUTH_SECRET: 's'.repeat(32),
      }),
    );

    expect(config.googleClientId).toBe('client.apps.googleusercontent.com');
    expect(config.secret).toBe('s'.repeat(32));
  });

  it('reads the allowed emails in lower case, without blanks', () => {
    const config = new AuthConfigService(
      fakeConfig({ AUTH_ALLOWED_EMAILS: ' A@Example.com , b@x.org' }),
    );

    expect([...config.allowedEmails]).toEqual(['a@example.com', 'b@x.org']);
    expect(new AuthConfigService(fakeConfig({})).allowedEmails.size).toBe(0);
  });

  it('makes a Secure __Host- cookie unless turned off', () => {
    const secure = new AuthConfigService(fakeConfig({}));
    const local = new AuthConfigService(fakeConfig({ AUTH_COOKIE_SECURE: 'false' }));

    expect(secure.cookieSecure).toBe(true);
    expect(secure.cookieName).toBe('__Host-ec_session');
    expect(secure.loginNonceCookieName).toBe('__Host-ec_login_nonce');
    expect(local.cookieSecure).toBe(false);
    expect(local.cookieName).toBe('ec_session');
    expect(local.loginNonceCookieName).toBe('ec_login_nonce');
  });

  it('sets an httpOnly, host-only cookie for the session lifetime', () => {
    const config = new AuthConfigService(
      fakeConfig({ AUTH_COOKIE_SAME_SITE: CookieSameSite.Strict }),
    );

    expect(config.cookieOptions()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_ABSOLUTE_TTL_SECONDS * 1000,
    });
    expect(config.clearCookieOptions()).not.toHaveProperty('maxAge');
    expect(config.loginNonceCookieOptions()).toMatchObject({ httpOnly: true, maxAge: 600_000 });
  });

  it('defaults SameSite to strict, also when empty', () => {
    expect(new AuthConfigService(fakeConfig({})).sameSite).toBe(CookieSameSite.Strict);
    expect(
      new AuthConfigService(fakeConfig({ AUTH_COOKIE_SAME_SITE: '' as CookieSameSite })).sameSite,
    ).toBe(CookieSameSite.Strict);
  });
});
