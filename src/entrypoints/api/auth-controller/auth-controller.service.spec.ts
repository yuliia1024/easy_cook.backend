import { AuthConfigService } from '../../../configs/auth-config/auth-config.service';
import { RateLimitName } from '../../../common/constants';
import { AuthService } from '../../../modules/services/auth/auth.service';
import { RedisThrottlerStorage } from '../../../providers/redis/redis-throttler.storage';
import { createMock } from '../../../test/create-mock';
import { buildUser, USER_ID } from '../../../test/fixtures';
import { rateLimitKey } from '../rate-limit/rate-limit.key';
import { AuthControllerService } from './auth-controller.service';

describe('AuthControllerService', () => {
  let authService: jest.Mocked<AuthService>;
  let rateLimits: jest.Mocked<RedisThrottlerStorage>;
  let service: AuthControllerService;
  const response = { cookie: jest.fn(), clearCookie: jest.fn() };
  const cookieOptions = { httpOnly: true, maxAge: 1 };
  const clearOptions = { httpOnly: true };
  const nonceOptions = { httpOnly: true, maxAge: 600_000 };
  const user = buildUser({ avatarUrl: 'https://lh3.googleusercontent.com/a/x' });
  const sessionValue = 'session-value-from-auth-service';

  beforeEach(() => {
    jest.clearAllMocks();
    authService = createMock<AuthService>();
    rateLimits = createMock<RedisThrottlerStorage>();
    service = new AuthControllerService(
      authService,
      {
        cookieName: '__Host-ec_session',
        loginNonceCookieName: '__Host-ec_login_nonce',
        cookieOptions: () => cookieOptions,
        clearCookieOptions: () => clearOptions,
        loginNonceCookieOptions: () => nonceOptions,
      } as unknown as AuthConfigService,
      rateLimits,
    );
  });

  it('returns a nonce and sets it as a cookie', async () => {
    authService.createLoginNonce.mockResolvedValue('nonce');

    await expect(service.createLoginNonce(response as never)).resolves.toEqual({ nonce: 'nonce' });
    expect(response.cookie).toHaveBeenCalledWith('__Host-ec_login_nonce', 'nonce', nonceOptions);
  });

  it('signs in with the nonce and the old session of the cookies, the new one only in the cookie, and forgets the failed attempts', async () => {
    authService.signInWithGoogle.mockResolvedValue({
      user,
      token: sessionValue,
      csrfToken: 'csrf',
    });

    const body = await service.signInWithGoogle(
      'id-token',
      { '__Host-ec_login_nonce': 'nonce', '__Host-ec_session': 'old' },
      'Firefox',
      'ip:1.2.3.4',
      response as never,
    );

    expect(authService.signInWithGoogle).toHaveBeenCalledWith(
      'id-token',
      'nonce',
      'Firefox',
      'old',
    );
    expect(response.clearCookie).toHaveBeenCalledWith('__Host-ec_login_nonce', clearOptions);
    expect(response.cookie).toHaveBeenCalledWith('__Host-ec_session', sessionValue, cookieOptions);
    expect(body).toEqual({
      user: { id: USER_ID, email: 'cook@example.com', name: 'Cook', avatarUrl: user.avatarUrl },
      csrfToken: 'csrf',
    });
    expect(JSON.stringify(body)).not.toContain(sessionValue);
    expect(rateLimits.forget).toHaveBeenCalledWith(
      rateLimitKey(RateLimitName.SignIn, 'ip:1.2.3.4'),
    );
  });

  it('drops the nonce cookie and sets no session when the sign-in fails', async () => {
    authService.signInWithGoogle.mockRejectedValue(new Error('nope'));

    await expect(
      service.signInWithGoogle('t', {}, undefined, 'ip:1.2.3.4', response as never),
    ).rejects.toThrow('nope');
    expect(response.clearCookie).toHaveBeenCalledWith('__Host-ec_login_nonce', clearOptions);
    expect(response.cookie).not.toHaveBeenCalled();
    expect(rateLimits.forget).not.toHaveBeenCalled();
  });

  it('gives the session user with a CSRF token', () => {
    authService.csrfTokenFor.mockReturnValue('csrf');

    expect(service.getSession({ user, tokenHash: 'hash' })).toMatchObject({
      user: { id: USER_ID },
      csrfToken: 'csrf',
    });
    expect(authService.csrfTokenFor).toHaveBeenCalledWith('hash');
  });

  it('signs out the session of the cookie and clears it', async () => {
    await service.signOut({ '__Host-ec_session': 'value' }, response as never);

    expect(authService.signOut).toHaveBeenCalledWith('value');
    expect(response.clearCookie).toHaveBeenCalledWith('__Host-ec_session', clearOptions);
  });

  it('signs out everywhere and clears the cookie', async () => {
    await service.signOutEverywhere({ user, tokenHash: 'hash' }, response as never);

    expect(authService.signOutEverywhere).toHaveBeenCalledWith(USER_ID);
    expect(response.clearCookie).toHaveBeenCalledWith('__Host-ec_session', clearOptions);
  });
});
