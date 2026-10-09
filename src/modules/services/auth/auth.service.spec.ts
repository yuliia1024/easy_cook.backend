import { JwtService } from '@nestjs/jwt';
import { TokenType } from '../../../common/constants';
import { UnauthorizedException } from '../../../common/exceptions';
import { AuthJwtConfigService } from '../../../configs/auth-jwt-config/auth-jwt-config.service';
import { createMock } from '../../../test/create-mock';
import { SESSION_ID, USER_ID } from '../../../test/fixtures';
import { AuthStorageService } from '../auth-storage/auth-storage.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const access = { secret: 'access-secret', expiresInSec: 900 };
  const refresh = { secret: 'refresh-secret', expiresInSec: 86400 };
  // Real signing and verification: the token format is part of what is tested.
  const jwtService = new JwtService({});
  let storage: jest.Mocked<AuthStorageService>;
  let service: AuthService;
  /** Simulates Redis: the last tokens saved per session. */
  let stored: Map<string, string>;

  beforeEach(() => {
    stored = new Map();
    storage = createMock<AuthStorageService>();
    storage.save.mockImplementation(async (userId, sid, tokens) => {
      stored.set(`${TokenType.Access}:${userId}:${sid}`, tokens.accessToken);
      stored.set(`${TokenType.Refresh}:${userId}:${sid}`, tokens.refreshToken);
    });
    storage.get.mockImplementation(
      async (type, userId, sid) => stored.get(`${type}:${userId}:${sid}`) ?? null,
    );

    service = new AuthService(
      jwtService,
      createMock<AuthJwtConfigService>({ access: () => access, refresh: () => refresh }),
      storage,
    );
  });

  describe('issueTokens', () => {
    it('signs an access/refresh pair for a new session and stores it', async () => {
      const tokens = await service.issueTokens(USER_ID);

      expect(tokens.expiresIn).toBe(900);
      const accessPayload = jwtService.verify(tokens.accessToken, { secret: access.secret });
      const refreshPayload = jwtService.verify(tokens.refreshToken, { secret: refresh.secret });
      expect(accessPayload).toMatchObject({ sub: USER_ID, type: TokenType.Access });
      expect(refreshPayload).toMatchObject({
        sub: USER_ID,
        type: TokenType.Refresh,
        sid: accessPayload.sid,
      });
      expect(accessPayload.exp - accessPayload.iat).toBe(900);
      expect(refreshPayload.exp - refreshPayload.iat).toBe(86400);
      expect(storage.save).toHaveBeenCalledWith(USER_ID, accessPayload.sid, {
        accessToken: tokens.accessToken,
        accessExpiresInSec: 900,
        refreshToken: tokens.refreshToken,
        refreshExpiresInSec: 86400,
      });
    });

    it('starts a separate session on every sign-in', async () => {
      const first = await service.issueTokens(USER_ID);
      const second = await service.issueTokens(USER_ID);

      expect(jwtService.decode(first.accessToken).sid).not.toBe(
        jwtService.decode(second.accessToken).sid,
      );
    });
  });

  describe('authenticate', () => {
    it('resolves a stored access token to the user and session', async () => {
      const { accessToken } = await service.issueTokens(USER_ID);
      const { sid } = jwtService.decode(accessToken);

      await expect(service.authenticate(accessToken)).resolves.toEqual({
        userId: USER_ID,
        sessionId: sid,
      });
    });

    it('rejects a revoked token (no longer in storage)', async () => {
      const { accessToken } = await service.issueTokens(USER_ID);
      stored.clear();

      await expect(service.authenticate(accessToken)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a refresh token used as an access token', async () => {
      const { refreshToken } = await service.issueTokens(USER_ID);

      await expect(service.authenticate(refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a token signed with another secret', async () => {
      const forged = jwtService.sign(
        { sub: USER_ID, sid: SESSION_ID, type: TokenType.Access },
        { secret: 'attacker' },
      );

      await expect(service.authenticate(forged)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an expired token', async () => {
      const expired = jwtService.sign(
        {
          sub: USER_ID,
          sid: SESSION_ID,
          type: TokenType.Access,
          exp: Math.floor(Date.now() / 1000) - 10,
        },
        { secret: access.secret },
      );

      await expect(service.authenticate(expired)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects garbage', async () => {
      await expect(service.authenticate('not-a-jwt')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token without a session id', async () => {
      const token = jwtService.sign(
        { sub: USER_ID, type: TokenType.Access },
        { secret: access.secret },
      );

      await expect(service.authenticate(token)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('rotates both tokens within the same session', async () => {
      const first = await service.issueTokens(USER_ID);
      const second = await service.refresh(first.refreshToken);

      expect(second.accessToken).not.toBe(first.accessToken);
      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(jwtService.decode(second.accessToken).sid).toBe(
        jwtService.decode(first.accessToken).sid,
      );
      await expect(service.authenticate(first.accessToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(service.authenticate(second.accessToken)).resolves.toBeDefined();
    });

    it('treats reuse of an old refresh token as theft and drops the session', async () => {
      const first = await service.issueTokens(USER_ID);
      await service.refresh(first.refreshToken);
      const { sid } = jwtService.decode(first.refreshToken);

      await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(storage.deleteSession).toHaveBeenCalledWith(USER_ID, sid);
    });

    it('rejects an access token used as a refresh token', async () => {
      const { accessToken } = await service.issueTokens(USER_ID);

      await expect(service.refresh(accessToken)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  it('revokeSession deletes the current session', async () => {
    await service.revokeSession({ userId: USER_ID, sessionId: SESSION_ID });

    expect(storage.deleteSession).toHaveBeenCalledWith(USER_ID, SESSION_ID);
  });

  it('revokeAllSessions deletes the user sessions, optionally keeping one', async () => {
    await service.revokeAllSessions(USER_ID, SESSION_ID);

    expect(storage.deleteAllSessions).toHaveBeenCalledWith(USER_ID, SESSION_ID);
  });
});
