import { Logger, OnModuleDestroy } from '@nestjs/common';
import { createClient } from 'redis';
import { RedisConfigService } from '../../configs/redis-config/redis-config.service';

type RedisClient = ReturnType<typeof createClient>;

export const REDIS_SERVICE = 'RedisService';

export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: RedisClient;

  constructor(redisConfig: RedisConfigService) {
    this.client = createClient(redisConfig.config());
    this.client.on('error', (err) => this.logger.error('Redis error', err?.stack ?? err));
  }

  public async connect(): Promise<void> {
    await this.client.connect();
    this.logger.log('Redis connected');
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  /** @param ex expire time in seconds */
  public async set(key: string, value: string, ex?: number): Promise<void> {
    await this.client.set(key, value, ex ? { EX: ex } : undefined);
  }

  /** SET NX: returns false when the key already exists. */
  public async setIfNotExists(key: string, value: string, ex: number): Promise<boolean> {
    const result = await this.client.set(key, value, { EX: ex, NX: true });
    return result === 'OK';
  }

  public async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  public async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  public async delete(key: string | string[]): Promise<number> {
    if (Array.isArray(key) && key.length === 0) {
      return 0;
    }
    return this.client.del(key);
  }

  public async hset(
    key: string,
    values: Record<string, string | number>,
    ex?: number,
  ): Promise<void> {
    const multi = this.client.multi().hSet(key, values);
    if (ex) {
      multi.expire(key, ex);
    }
    await multi.exec();
  }

  public async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hGetAll(key);
  }

  public async hincrby(key: string, field: string, increment: number): Promise<number> {
    return this.client.hIncrBy(key, field, increment);
  }

  /** SCAN-based (non blocking, unlike KEYS) lookup of every key matching `pattern`. */
  public async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    for await (const key of this.client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      keys.push(key);
    }
    return keys;
  }
}
