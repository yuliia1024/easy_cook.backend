import { Injectable } from '@nestjs/common';
import { REDIS_KEYS, SESSION_ABSOLUTE_TTL_SECONDS } from '../../../common/constants';
import { StoredSession } from '../../../common/types';
import { RedisService } from '../../../providers/redis/redis.service';

/**
 * KEYS the sessions of a user; ARGV keep, the session key prefix. Drops the hashes of sessions
 * that expired, then ends the oldest live ones beyond `keep`. Returns how many it ended.
 */
const TRIM_SCRIPT = `
local live = {}
for _, hash in ipairs(redis.call('ZRANGE', KEYS[1], 0, -1)) do
  if redis.call('EXISTS', ARGV[2] .. hash) == 1 then
    table.insert(live, hash)
  else
    redis.call('ZREM', KEYS[1], hash)
  end
end
local excess = #live - tonumber(ARGV[1])
for i = 1, excess do
  redis.call('DEL', ARGV[2] .. live[i])
  redis.call('ZREM', KEYS[1], live[i])
end
return math.max(excess, 0)
`;

/** KEYS the sessions of a user; ARGV the session key prefix. Ends all of them, atomically. */
const DELETE_ALL_SCRIPT = `
local hashes = redis.call('ZRANGE', KEYS[1], 0, -1)
for _, hash in ipairs(hashes) do
  redis.call('DEL', ARGV[1] .. hash)
end
redis.call('DEL', KEYS[1])
return #hashes
`;

const SESSION_KEY_PREFIX = REDIS_KEYS.session('');

/**
 * Sessions in Redis, keyed by the sha256 of their token (a leaked dump holds no usable token), the
 * sessions of each user in a sorted set by sign-in time (to end all of them, or the oldest beyond
 * the limit), and the one-time nonces of Google sign-ins. Every key expires.
 */
@Injectable()
export class AuthSessionRepository {
  constructor(private readonly redis: RedisService) {}

  public async create(
    tokenHash: string,
    session: StoredSession,
    ttlSeconds: number,
  ): Promise<void> {
    const userKey = REDIS_KEYS.userSessions(session.userId);
    await this.redis.client
      .multi()
      .set(REDIS_KEYS.session(tokenHash), JSON.stringify(session), 'EX', ttlSeconds, 'NX')
      .zadd(userKey, session.createdAt, tokenHash)
      .expire(userKey, SESSION_ABSOLUTE_TTL_SECONDS)
      .exec();
  }

  /** Ends the oldest live sessions of the user beyond the newest `keep` (`TRIM_SCRIPT`). */
  public async trimUserSessions(userId: string, keep: number): Promise<void> {
    await this.redis.client.eval(
      TRIM_SCRIPT,
      1,
      REDIS_KEYS.userSessions(userId),
      keep,
      SESSION_KEY_PREFIX,
    );
  }

  /** Null for an unknown or expired session, or one that cannot be read. */
  public async find(tokenHash: string): Promise<StoredSession | null> {
    const value = await this.redis.client.get(REDIS_KEYS.session(tokenHash));
    if (!value) {
      return null;
    }
    try {
      return JSON.parse(value) as StoredSession;
    } catch {
      return null;
    }
  }

  /** Rewrites a session that still exists (`XX`): one ended meanwhile is not brought back. */
  public async touch(tokenHash: string, session: StoredSession, ttlSeconds: number): Promise<void> {
    await this.redis.client.set(
      REDIS_KEYS.session(tokenHash),
      JSON.stringify(session),
      'EX',
      ttlSeconds,
      'XX',
    );
  }

  public async delete(tokenHash: string, userId: string): Promise<void> {
    await this.redis.client
      .multi()
      .del(REDIS_KEYS.session(tokenHash))
      .zrem(REDIS_KEYS.userSessions(userId), tokenHash)
      .exec();
  }

  public async deleteAllOfUser(userId: string): Promise<void> {
    await this.redis.client.eval(
      DELETE_ALL_SCRIPT,
      1,
      REDIS_KEYS.userSessions(userId),
      SESSION_KEY_PREFIX,
    );
  }

  public async saveLoginNonce(nonceHash: string, ttlSeconds: number): Promise<void> {
    await this.redis.client.set(REDIS_KEYS.loginNonce(nonceHash), '1', 'EX', ttlSeconds);
  }

  /** True once for a nonce that was issued and has not expired (`GETDEL`: no second use). */
  public async consumeLoginNonce(nonceHash: string): Promise<boolean> {
    return (await this.redis.client.getdel(REDIS_KEYS.loginNonce(nonceHash))) !== null;
  }
}
