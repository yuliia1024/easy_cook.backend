import { Logger } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';

describe('RedisThrottlerStorage', () => {
  const client = { status: 'ready', eval: jest.fn(), del: jest.fn() };
  let storage: RedisThrottlerStorage;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers({ now: 1_000_000 });
    client.status = 'ready';
    client.eval.mockReset();
    client.del.mockReset().mockResolvedValue(1);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    storage = new RedisThrottlerStorage({ client } as unknown as RedisService);
  });

  afterEach(() => {
    storage.onApplicationShutdown();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('in Redis', () => {
    it('counts a hit atomically under the hashed key', async () => {
      client.eval.mockResolvedValue([3, 59_500, 0]);

      await expect(storage.increment('key-hash', 60_000, 10, 300_000)).resolves.toEqual({
        totalHits: 3,
        timeToExpire: 60,
        isBlocked: false,
        timeToBlockExpire: 0,
      });
      expect(client.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call('INCR', KEYS[1])"),
        2,
        'throttle:key-hash',
        'throttle:key-hash:blocked',
        60_000,
        10,
        300_000,
      );
    });

    it('reports a block', async () => {
      client.eval.mockResolvedValue([11, 0, 120_000]);

      await expect(storage.increment('k', 60_000, 10, 120_000)).resolves.toMatchObject({
        isBlocked: true,
        timeToBlockExpire: 120,
      });
    });

    it('forgets the hits of a key, in Redis and in memory', async () => {
      await storage.forget('k');

      expect(client.del).toHaveBeenCalledWith('throttle:k');
    });
  });

  describe('in memory, while Redis fails', () => {
    beforeEach(() => {
      client.eval.mockRejectedValue(new Error('ECONNREFUSED'));
    });

    it('limits, then blocks without counting the blocked requests', async () => {
      const hit = () => storage.increment('k', 60_000, 2, 600_000);

      await expect(hit()).resolves.toMatchObject({ totalHits: 1, isBlocked: false });
      await expect(hit()).resolves.toMatchObject({ totalHits: 2, isBlocked: false });
      await expect(hit()).resolves.toMatchObject({ isBlocked: true, timeToBlockExpire: 600 });
      expect(warn).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(300_000);
      await expect(hit()).resolves.toMatchObject({ isBlocked: true, timeToBlockExpire: 300 });
    });

    it('gives the full limit again once the block ends', async () => {
      const hit = () => storage.increment('k', 60_000, 1, 600_000);
      await hit();
      await hit();

      jest.advanceTimersByTime(600_000);

      await expect(hit()).resolves.toMatchObject({ totalHits: 1, isBlocked: false });
    });

    it('starts a new window once one expires', async () => {
      const hit = () => storage.increment('k', 60_000, 1, 600_000);
      await hit();

      jest.advanceTimersByTime(60_000);

      await expect(hit()).resolves.toMatchObject({ totalHits: 1, isBlocked: false });
    });

    it('forgets the hits of a key', async () => {
      const hit = () => storage.increment('k', 60_000, 2, 600_000);
      await hit();
      await hit();

      await storage.forget('k');

      await expect(hit()).resolves.toMatchObject({ totalHits: 1, isBlocked: false });
    });

    it('goes back to Redis once it answers again', async () => {
      client.eval.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([1, 60_000, 0]);

      await storage.increment('k', 60_000, 10, 0);
      await expect(storage.increment('k', 60_000, 10, 0)).resolves.toMatchObject({
        totalHits: 1,
        timeToExpire: 60,
      });
      expect(client.eval).toHaveBeenCalledTimes(2);
    });
  });

  it('counts in memory without waiting on Redis while it is not connected', async () => {
    client.status = 'reconnecting';

    await expect(storage.increment('k', 60_000, 1, 600_000)).resolves.toMatchObject({
      totalHits: 1,
    });
    await storage.forget('k');

    expect(client.eval).not.toHaveBeenCalled();
    expect(client.del).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reconnecting'));
  });
});
