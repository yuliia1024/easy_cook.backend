import { Logger } from '@nestjs/common';
import {
  DatabaseUnavailableException,
  SessionUnavailableException,
} from '../../../common/exceptions';
import { getCurrentUserId, runWithRequestId } from '../../../common/logger';
import { AuthConfigService } from '../../../configs/auth-config/auth-config.service';
import { AuthService } from '../../../modules/services/auth/auth.service';
import { createMock } from '../../../test/create-mock';
import { buildUser, USER_ID } from '../../../test/fixtures';
import { httpContext } from '../../../test/http-context';
import { SessionGuard } from './session.guard';

describe('SessionGuard', () => {
  let authService: jest.Mocked<AuthService>;
  let guard: SessionGuard;

  beforeEach(() => {
    authService = createMock<AuthService>();
    guard = new SessionGuard(authService, { cookieName: '__Host-ec_session' } as AuthConfigService);
  });

  it('puts a live session onto the request and its user into the context', async () => {
    const session = { user: buildUser(), tokenHash: 'hash' };
    authService.authenticate.mockResolvedValue(session);
    const request: Record<string, unknown> = { cookies: { '__Host-ec_session': 'token' } };

    await runWithRequestId('r1', async () => {
      await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);
      expect(getCurrentUserId()).toBe(USER_ID);
    });
    expect(authService.authenticate).toHaveBeenCalledWith('token');
    expect(request.authSession).toBe(session);
  });

  it('lets a request without a session through, marking nothing', async () => {
    authService.authenticate.mockResolvedValue(null);
    const request: Record<string, unknown> = {};

    await runWithRequestId('r1', async () => {
      await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);
      expect(getCurrentUserId()).toBeUndefined();
    });
    expect(authService.authenticate).toHaveBeenCalledWith(undefined);
    expect(request.authSession).toBeUndefined();
  });

  it('is 503, not 401, when the sessions cannot be read', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    authService.authenticate.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(guard.canActivate(httpContext({ cookies: {} }))).rejects.toBeInstanceOf(
      SessionUnavailableException,
    );
  });

  it('keeps the status of an application error', async () => {
    const error = new DatabaseUnavailableException();
    authService.authenticate.mockRejectedValue(error);

    await expect(guard.canActivate(httpContext({ cookies: {} }))).rejects.toBe(error);
  });
});
