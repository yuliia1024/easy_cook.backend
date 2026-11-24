import { Reflector } from '@nestjs/core';
import {
  CsrfTokenForbiddenException,
  SessionRequiredUnauthorizedException,
} from '../../../common/exceptions';
import { AuthService } from '../../../modules/services/auth/auth.service';
import { createMock } from '../../../test/create-mock';
import { buildUser } from '../../../test/fixtures';
import { httpContext } from '../../../test/http-context';
import { AuthGuard } from './auth.guard';
import { Public } from './public.decorator';

class Routes {
  @Public()
  open(): void {}

  closed(): void {}
}

describe('AuthGuard', () => {
  let authService: jest.Mocked<AuthService>;
  let guard: AuthGuard;
  const session = { user: buildUser(), tokenHash: 'hash' };
  const context = (request: Record<string, unknown>, handler: keyof Routes = 'closed') =>
    httpContext({ headers: {}, ...request }, Routes.prototype[handler], Routes);

  beforeEach(() => {
    authService = createMock<AuthService>();
    authService.isCsrfTokenValid.mockImplementation((_hash, sent) => sent === 'csrf-ok');
    guard = new AuthGuard(new Reflector(), authService);
  });

  it('lets a public route through without a session', () => {
    expect(guard.canActivate(context({ method: 'POST' }, 'open'))).toBe(true);
  });

  it('is 401 without a session', () => {
    expect(() => guard.canActivate(context({ method: 'GET' }))).toThrow(
      SessionRequiredUnauthorizedException,
    );
  });

  it('lets a safe request with a session through without a CSRF token', () => {
    expect(guard.canActivate(context({ method: 'GET', authSession: session }))).toBe(true);
    expect(authService.isCsrfTokenValid).not.toHaveBeenCalled();
  });

  it('requires the CSRF token of the session on an unsafe request', () => {
    expect(() =>
      guard.canActivate(context({ method: 'PATCH', authSession: session, headers: {} })),
    ).toThrow(CsrfTokenForbiddenException);
    expect(() =>
      guard.canActivate(
        context({ method: 'DELETE', authSession: session, headers: { 'x-csrf-token': 'stolen' } }),
      ),
    ).toThrow(CsrfTokenForbiddenException);
    expect(
      guard.canActivate(
        context({ method: 'POST', authSession: session, headers: { 'x-csrf-token': 'csrf-ok' } }),
      ),
    ).toBe(true);
    expect(authService.isCsrfTokenValid).toHaveBeenCalledWith('hash', 'csrf-ok');
  });
});
