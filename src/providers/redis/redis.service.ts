import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { RedisConfigService } from '../../configs/redis-config/redis-config.service';

/** Commands give up after this many reconnects instead of hanging the request. */
const MAX_RETRIES_PER_REQUEST = 2;

/** The one Redis connection of the app (sessions, rate limits). */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public readonly client: Redis;

  constructor(redisConfig: RedisConfigService) {
    this.client = new Redis(redisConfig.url, { maxRetriesPerRequest: MAX_RETRIES_PER_REQUEST });
    this.client.on('ready', () => this.logger.log('Redis connected'));
    this.client.on('error', (error) => this.logger.error(`Redis error: ${error.message}`));
  }

  public async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  /** `PING`; false instead of throwing when Redis cannot be reached. */
  public async isHealthy(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch (error) {
      this.logger.error('Redis health check failed', (error as Error)?.stack);
      return false;
    }
  }
}
