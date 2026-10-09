import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../../modules/services/auth/jwt-auth.guard';
import { createMock } from '../../../test/create-mock';
import { SESSION_ID, USER_ID } from '../../../test/fixtures';
import { AuthControllerService } from './auth-controller.service';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  let service: jest.Mocked<AuthControllerService>;
  let controller: AuthController;
  const user = { userId: USER_ID, sessionId: SESSION_ID };

  beforeEach(() => {
    service = createMock<AuthControllerService>();
    controller = new AuthController(service);
  });

  it.each([
    ['signUp', { email: 'a@b.c', password: 'Secret123' }],
    ['verifyEmail', { email: 'a@b.c', code: '123456' }],
    ['resendVerification', { email: 'a@b.c' }],
    ['signIn', { email: 'a@b.c', password: 'Secret123' }],
    ['refresh', { refreshToken: 'r' }],
    ['forgotPassword', { email: 'a@b.c' }],
    ['resetPassword', { email: 'a@b.c', code: '123456', password: 'Secret123' }],
  ] as const)('%s delegates to the service', async (method, dto) => {
    (service[method] as jest.Mock).mockResolvedValue('result');

    await expect((controller[method] as (d: unknown) => Promise<unknown>)(dto)).resolves.toBe(
      'result',
    );
    expect(service[method]).toHaveBeenCalledWith(dto);
  });

  it.each(['signOut', 'signOutAll'] as const)('%s passes the current session', async (method) => {
    await controller[method](user);

    expect(service[method]).toHaveBeenCalledWith(user);
  });

  describe('metadata', () => {
    const guardsOf = (method: keyof AuthController): unknown[] =>
      Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype[method]) ?? [];
    const codeOf = (method: keyof AuthController): number | undefined =>
      Reflect.getMetadata(HTTP_CODE_METADATA, AuthController.prototype[method]);

    it('guards only the sign-out routes', () => {
      expect(guardsOf('signOut')).toContain(JwtAuthGuard);
      expect(guardsOf('signOutAll')).toContain(JwtAuthGuard);
      for (const open of [
        'signUp',
        'signIn',
        'verifyEmail',
        'refresh',
        'forgotPassword',
        'resetPassword',
      ] as const) {
        expect(guardsOf(open)).toHaveLength(0);
      }
    });

    it('answers 200 / 204 where nothing is created', () => {
      expect(codeOf('signUp')).toBeUndefined();
      expect(codeOf('signIn')).toBe(HttpStatus.OK);
      expect(codeOf('verifyEmail')).toBe(HttpStatus.OK);
      expect(codeOf('refresh')).toBe(HttpStatus.OK);
      expect(codeOf('signOut')).toBe(HttpStatus.NO_CONTENT);
      expect(codeOf('forgotPassword')).toBe(HttpStatus.NO_CONTENT);
      expect(codeOf('resetPassword')).toBe(HttpStatus.NO_CONTENT);
    });

    it('applies the strict auth rate limit to the whole controller', () => {
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', AuthController)).toBe(10);
      expect(Reflect.getMetadata('THROTTLER:TTLdefault', AuthController)).toBe(60_000);
    });
  });
});
