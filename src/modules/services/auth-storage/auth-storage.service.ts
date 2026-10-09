import { Inject, Injectable } from '@nestjs/common';
import { REDIS_KEYS, TokenType } from '../../../common/constants';
import { REDIS_SERVICE, RedisService } from '../../../providers/redis/redis.service';

export interface StoredTokens {
  accessToken: string;
  accessExpiresInSec: number;
  refreshToken: string;
  refreshExpiresInSec: number;
}

/**
 * Issued JWTs, one pair per login session. A token is only accepted while it is stored here,
 * which is what makes sign-out and "revoke all sessions" effective before the JWT expires.
 */
@Injectable()
export class AuthStorageService {
  constructor(@Inject(REDIS_SERVICE) private readonly redisService: RedisService) {}

  public async save(userId: string, sessionId: string, tokens: StoredTokens): Promise<void> {
    await Promise.all([
      this.redisService.set(
        REDIS_KEYS.authToken(TokenType.Access, userId, sessionId),
        tokens.accessToken,
        tokens.accessExpiresInSec,
      ),
      this.redisService.set(
        REDIS_KEYS.authToken(TokenType.Refresh, userId, sessionId),
        tokens.refreshToken,
        tokens.refreshExpiresInSec,
      ),
    ]);
  }

  public async get(type: TokenType, userId: string, sessionId: string): Promise<string | null> {
    return this.redisService.get(REDIS_KEYS.authToken(type, userId, sessionId));
  }

  public async deleteSession(userId: string, sessionId: string): Promise<void> {
    await this.redisService.delete([
      REDIS_KEYS.authToken(TokenType.Access, userId, sessionId),
      REDIS_KEYS.authToken(TokenType.Refresh, userId, sessionId),
    ]);
  }

  /** Signs the user out everywhere, optionally keeping the session making the request. */
  public async deleteAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
    const keys = await this.redisService.scanKeys(REDIS_KEYS.authTokenPattern(userId));
    const toDelete = exceptSessionId
      ? keys.filter((k) => !k.endsWith(`:${exceptSessionId}`))
      : keys;
    await this.redisService.delete(toDelete);
  }
}
