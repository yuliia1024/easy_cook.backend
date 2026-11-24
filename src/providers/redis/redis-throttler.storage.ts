import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { RATE_LIMIT_REDIS_KEY } from '../../common/constants';
import { RedisService } from './redis.service';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

interface MemoryWindow {
  hits: number;
  expiresAt: number;
  blockedUntil: number;
}

/** How often a Redis outage is logged while the limits run in memory. */
const FALLBACK_LOG_INTERVAL_MS = 60_000;
const MEMORY_SWEEP_INTERVAL_MS = 60_000;

/**
 * KEYS hits, block; ARGV window ms, limit, block ms. Returns hits, ms left in the window, ms left
 * of the block. A blocked client is not counted; a block starts a new window, so the client gets
 * the full limit once it ends.
 */
const INCREMENT_SCRIPT = `
local blocked = redis.call('PTTL', KEYS[2])
if blocked > 0 then
  return {tonumber(ARGV[2]) + 1, 0, blocked}
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  redis.call('DEL', KEYS[1])
  return {hits, 0, tonumber(ARGV[3])}
end
return {hits, ttl, 0}
`;

/**
 * The rate limits in Redis: shared by every instance of the API and kept across restarts. While
 * Redis is not connected, or a command fails, a request is counted in the memory of this process
 * instead, with the same rules, so the limits keep holding (per instance) rather than failing
 * open or failing every request.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnApplicationShutdown {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly memory = new Map<string, MemoryWindow>();
  private readonly sweep: NodeJS.Timeout;
  private lastFallbackLogAt = 0;

  constructor(private readonly redis: RedisService) {
    this.sweep = setInterval(() => this.sweepMemory(), MEMORY_SWEEP_INTERVAL_MS);
    this.sweep.unref();
  }

  public async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): Promise<ThrottlerStorageRecord> {
    if (this.redis.client.status === 'ready') {
      try {
        return await this.incrementInRedis(key, ttl, limit, blockDuration);
      } catch (error) {
        this.logFallback((error as Error).message);
      }
    } else {
      this.logFallback(`connection ${this.redis.client.status}`);
    }
    return this.incrementInMemory(key, ttl, limit, blockDuration);
  }

  /** Drops the hits counted under `key` (not a block): a successful sign-in clears the failed ones. */
  public async forget(key: string): Promise<void> {
    this.memory.delete(key);
    if (this.redis.client.status !== 'ready') {
      return;
    }
    await this.redis.client.del(RATE_LIMIT_REDIS_KEY(key)).catch((error: Error) => {
      this.logFallback(error.message);
    });
  }

  public onApplicationShutdown(): void {
    clearInterval(this.sweep);
  }

  private async incrementInRedis(
    key: string,
    ttl: number,
    limit: number,
    block: number,
  ): Promise<ThrottlerStorageRecord> {
    const hitsKey = RATE_LIMIT_REDIS_KEY(key);
    const [totalHits, ttlMs, blockMs] = (await this.redis.client.eval(
      INCREMENT_SCRIPT,
      2,
      hitsKey,
      `${hitsKey}:blocked`,
      ttl,
      limit,
      block,
    )) as [number, number, number];

    return this.record(totalHits, ttlMs, blockMs);
  }

  /** `INCREMENT_SCRIPT` on a map. */
  private incrementInMemory(
    key: string,
    ttl: number,
    limit: number,
    block: number,
  ): ThrottlerStorageRecord {
    const now = Date.now();
    const window = this.memory.get(key);
    if (window && window.blockedUntil > now) {
      return this.record(limit + 1, 0, window.blockedUntil - now);
    }
    const current =
      window && window.expiresAt > now
        ? window
        : { hits: 0, expiresAt: now + ttl, blockedUntil: 0 };
    current.hits += 1;
    if (current.hits > limit) {
      this.memory.set(key, { hits: 0, expiresAt: 0, blockedUntil: now + block });
      return this.record(current.hits, 0, block);
    }
    this.memory.set(key, current);
    return this.record(current.hits, current.expiresAt - now, 0);
  }

  private record(totalHits: number, ttlMs: number, blockMs: number): ThrottlerStorageRecord {
    return {
      totalHits,
      timeToExpire: Math.max(0, Math.ceil(ttlMs / 1000)),
      isBlocked: blockMs > 0,
      timeToBlockExpire: Math.max(0, Math.ceil(blockMs / 1000)),
    };
  }

  private sweepMemory(now = Date.now()): void {
    for (const [key, window] of this.memory) {
      if (window.expiresAt <= now && window.blockedUntil <= now) {
        this.memory.delete(key);
      }
    }
  }

  private logFallback(reason: string): void {
    const now = Date.now();
    if (now - this.lastFallbackLogAt >= FALLBACK_LOG_INTERVAL_MS) {
      this.lastFallbackLogAt = now;
      this.logger.warn(`Redis unavailable, rate limits counted in memory: ${reason}`);
    }
  }
}
