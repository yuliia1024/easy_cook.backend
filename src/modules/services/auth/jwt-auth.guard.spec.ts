import { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '../../../common/exceptions';
import { createMock } from '../../../test/create-mock';
import { SESSION_ID, USER_ID } from '../../../test/fixtures';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let authService: jest.Mocked<AuthService>;
  let guard: JwtAuthGuard;

  const contextFor = (req: Record<string, unknown>): ExecutionContext =>
    ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;

  beforeEach(() => {
    authService = createMock<AuthService>();
    guard = new JwtAuthGuard(authService);
  });

  it('authenticates a bearer token and attaches the user to the request', async () => {
    const user = { userId: USER_ID, sessionId: SESSION_ID };
    authService.authenticate.mockResolvedValue(user);
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer abc.def.ghi' } };

    await expect(guard.canActivate(contextFor(req))).resolves.toBe(true);
    expect(authService.authenticate).toHaveBeenCalledWith('abc.def.ghi');
    expect(req.user).toEqual(user);
  });

  it.each([
    ['no header', undefined],
    ['another scheme', 'Basic abc'],
    ['an empty bearer', 'Bearer '],
    ['a bare token', 'abc.def.ghi'],
  ])('rejects %s', async (_case, authorization) => {
    await expect(
      guard.canActivate(contextFor({ headers: { authorization } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authService.authenticate).not.toHaveBeenCalled();
  });

  it('propagates a rejected token', async () => {
    authService.authenticate.mockRejectedValue(new UnauthorizedException());

    await expect(
      guard.canActivate(contextFor({ headers: { authorization: 'Bearer revoked' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
