import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { TokenType } from '../../../common/constants';
import { UnauthorizedException } from '../../../common/exceptions';
import { AuthUser } from '../../../common/types';
import {
  AuthJwtConfigService,
  JwtTokenConfig,
} from '../../../configs/auth-jwt-config/auth-jwt-config.service';
import { AuthStorageService } from '../auth-storage/auth-storage.service';

interface JwtPayload {
  sub: string;
  sid: string;
  type: TokenType;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authJwtConfigService: AuthJwtConfigService,
    private readonly authStorageService: AuthStorageService,
  ) {}

  /** Starts a new login session. */
  public async issueTokens(userId: string): Promise<AuthTokens> {
    return this.issueForSession(userId, randomUUID());
  }

  /** Resolves a bearer token to its user, or throws when it is invalid, expired or revoked. */
  public async authenticate(accessToken: string): Promise<AuthUser> {
    const payload = await this.verify(accessToken, TokenType.Access);
    const stored = await this.authStorageService.get(TokenType.Access, payload.sub, payload.sid);

    if (stored !== accessToken) {
      throw new UnauthorizedException();
    }

    return { userId: payload.sub, sessionId: payload.sid };
  }

  /**
   * Rotates the pair of a session. A refresh token is single use: presenting one that is no
   * longer stored means it was already rotated, possibly by someone else, so the whole session
   * is dropped.
   */
  public async refresh(refreshToken: string): Promise<AuthTokens> {
    const payload = await this.verify(refreshToken, TokenType.Refresh);
    const stored = await this.authStorageService.get(TokenType.Refresh, payload.sub, payload.sid);

    if (stored !== refreshToken) {
      await this.authStorageService.deleteSession(payload.sub, payload.sid);
      throw new UnauthorizedException();
    }

    return this.issueForSession(payload.sub, payload.sid);
  }

  public async revokeSession(user: AuthUser): Promise<void> {
    await this.authStorageService.deleteSession(user.userId, user.sessionId);
  }

  public async revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
    await this.authStorageService.deleteAllSessions(userId, exceptSessionId);
  }

  private async issueForSession(userId: string, sessionId: string): Promise<AuthTokens> {
    const access = this.authJwtConfigService.access();
    const refresh = this.authJwtConfigService.refresh();

    const [accessToken, refreshToken] = await Promise.all([
      this.sign(userId, sessionId, TokenType.Access, access),
      this.sign(userId, sessionId, TokenType.Refresh, refresh),
    ]);

    await this.authStorageService.save(userId, sessionId, {
      accessToken,
      accessExpiresInSec: access.expiresInSec,
      refreshToken,
      refreshExpiresInSec: refresh.expiresInSec,
    });

    return { accessToken, refreshToken, expiresIn: access.expiresInSec };
  }

  private async sign(
    userId: string,
    sessionId: string,
    type: TokenType,
    config: JwtTokenConfig,
  ): Promise<string> {
    const payload: JwtPayload = { sub: userId, sid: sessionId, type };

    // `jwtid` keeps two tokens signed within the same second distinct.
    return this.jwtService.signAsync(payload, {
      secret: config.secret,
      expiresIn: config.expiresInSec,
      jwtid: randomUUID(),
    });
  }

  private async verify(token: string, type: TokenType): Promise<JwtPayload> {
    const config =
      type === TokenType.Access
        ? this.authJwtConfigService.access()
        : this.authJwtConfigService.refresh();

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, { secret: config.secret });
    } catch {
      throw new UnauthorizedException();
    }

    if (payload?.type !== type || !payload.sub || !payload.sid) {
      throw new UnauthorizedException();
    }

    return payload;
  }
}
