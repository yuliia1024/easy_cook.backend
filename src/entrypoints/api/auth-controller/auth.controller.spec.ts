import { RateLimitName } from '../../../common/constants';
import { createMock } from '../../../test/create-mock';
import { buildUser } from '../../../test/fixtures';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { RATE_LIMIT_KEY } from '../rate-limit/rate-limit.decorator';
import { AuthControllerService } from './auth-controller.service';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  let service: jest.Mocked<AuthControllerService>;
  let controller: AuthController;
  const response = {} as never;
  const session = { user: buildUser(), tokenHash: 'hash' };

  beforeEach(() => {
    service = createMock<AuthControllerService>();
    controller = new AuthController(service);
  });

  it('createNonce', async () => {
    service.createLoginNonce.mockResolvedValue({ nonce: 'n' });

    await expect(controller.createNonce(response)).resolves.toEqual({ nonce: 'n' });
  });

  it('signInWithGoogle passes the token, cookies, user agent and rate limit tracker', async () => {
    const request = { cookies: { a: '1' }, headers: { 'user-agent': 'Firefox' }, ip: '1.2.3.4' };

    await controller.signInWithGoogle({ idToken: 'id' }, request as never, response);
    await controller.signInWithGoogle({ idToken: 'id' }, { headers: {} } as never, response);

    expect(service.signInWithGoogle.mock.calls).toEqual([
      ['id', { a: '1' }, 'Firefox', 'ip:1.2.3.4', response],
      ['id', {}, undefined, 'ip:unknown', response],
    ]);
  });

  it('getSession / signOut / signOutEverywhere', async () => {
    controller.getSession(session);
    await controller.signOut({ cookies: { a: '1' } } as never, response);
    await controller.signOutEverywhere(session, response);

    expect(service.getSession).toHaveBeenCalledWith(session);
    expect(service.signOut).toHaveBeenCalledWith({ a: '1' }, response);
    expect(service.signOutEverywhere).toHaveBeenCalledWith(session, response);
  });

  it('makes only the nonce and the sign-in public, and limits the sign-in', () => {
    const meta = (key: string, handler: keyof AuthController): unknown =>
      Reflect.getMetadata(key, AuthController.prototype[handler]);

    expect(meta(IS_PUBLIC_KEY, 'createNonce')).toBe(true);
    expect(meta(IS_PUBLIC_KEY, 'signInWithGoogle')).toBe(true);
    expect(meta(IS_PUBLIC_KEY, 'getSession')).toBeUndefined();
    expect(meta(IS_PUBLIC_KEY, 'signOut')).toBeUndefined();
    expect(meta(IS_PUBLIC_KEY, 'signOutEverywhere')).toBeUndefined();
    expect(meta(RATE_LIMIT_KEY, 'signInWithGoogle')).toBe(RateLimitName.SignIn);
  });
});
