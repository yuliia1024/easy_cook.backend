import { setTimeout as sleep } from 'node:timers/promises';
import { RedisConfigService } from '../src/configs/redis-config/redis-config.service';
import { AuthSessionRepository } from '../src/modules/data-access/auth-session/auth-session.repository';
import { RedisService } from '../src/providers/redis/redis.service';
import { RedisThrottlerStorage } from '../src/providers/redis/redis-throttler.storage';

/** The Lua scripts on the test Redis: what a mocked `eval` cannot show. */
describe('Redis scripts (e2e)', () => {
  const redis = new RedisService({ url: process.env.REDIS_URL } as RedisConfigService);
  const storage = new RedisThrottlerStorage(redis);
  const sessions = new AuthSessionRepository(redis);
  const key = 'e2e-scripts';
  const session = (createdAt: number) => ({
    userId: 'scripts-user',
    createdAt,
    lastSeenAt: createdAt,
    userAgent: null,
  });

  beforeAll(async () => {
    await redis.client.ping();
  });

  beforeEach(async () => {
    const keys = [
      ...(await redis.client.keys('throttle:e2e-scripts*')),
      ...(await redis.client.keys('auth:*scripts*')),
      ...(await redis.client.keys('auth:session:s*')),
    ];
    if (keys.length > 0) {
      await redis.client.del(...keys);
    }
  });

  afterAll(async () => {
    storage.onApplicationShutdown();
    await redis.onModuleDestroy();
  });

  describe('rate limits', () => {
    const hit = () => storage.increment(key, 60_000, 2, 300);

    it('blocks past the limit without counting the blocked requests', async () => {
      await expect(hit()).resolves.toMatchObject({ totalHits: 1, isBlocked: false });
      await expect(hit()).resolves.toMatchObject({ totalHits: 2, isBlocked: false });
      await expect(hit()).resolves.toMatchObject({ isBlocked: true, timeToBlockExpire: 1 });
      await expect(hit()).resolves.toMatchObject({ isBlocked: true });

      expect(await redis.client.exists(`throttle:${key}`)).toBe(0);
    });

    it('gives the full limit again once the block ends', async () => {
      for (let i = 0; i < 4; i += 1) {
        await hit();
      }

      await sleep(350);

      await expect(hit()).resolves.toMatchObject({ totalHits: 1, isBlocked: false });
      await expect(hit()).resolves.toMatchObject({ totalHits: 2, isBlocked: false });
    });

    it('forgets the hits of a key', async () => {
      await hit();
      await hit();

      await storage.forget(key);

      await expect(hit()).resolves.toMatchObject({ totalHits: 1, isBlocked: false });
    });
  });

  describe('sessions', () => {
    it('trims the oldest live sessions, not counting the expired ones', async () => {
      for (const [hash, createdAt] of [
        ['s1', 1],
        ['s2', 2],
        ['s3', 3],
      ] as const) {
        await sessions.create(hash, session(createdAt), 60);
      }
      await redis.client.del('auth:session:s2');

      await sessions.trimUserSessions('scripts-user', 2);

      expect(await sessions.find('s1')).not.toBeNull();
      expect(await sessions.find('s3')).not.toBeNull();
      expect(await redis.client.zrange('auth:user-sessions:scripts-user', 0, -1)).toEqual([
        's1',
        's3',
      ]);

      await sessions.create('s4', session(4), 60);
      await sessions.trimUserSessions('scripts-user', 2);

      expect(await sessions.find('s1')).toBeNull();
      expect(await redis.client.zrange('auth:user-sessions:scripts-user', 0, -1)).toEqual([
        's3',
        's4',
      ]);
    });
  });
});
