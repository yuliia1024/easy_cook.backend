import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { DatabaseUnavailableException, RedisUnavailableException } from '../../common/exceptions';
import { PrismaService } from '../../providers/prisma/prisma.service';
import { RedisService } from '../../providers/redis/redis.service';
import { Public } from './auth/public.decorator';

@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /** 503 when the database or Redis (the sessions) cannot be reached. */
  @Get()
  async check(): Promise<{ status: string; database: string; redis: string }> {
    const [database, redis] = await Promise.all([
      this.prismaService.isHealthy(),
      this.redisService.isHealthy(),
    ]);
    if (!database) {
      throw new DatabaseUnavailableException();
    }
    if (!redis) {
      throw new RedisUnavailableException();
    }
    return { status: 'ok', database: 'up', redis: 'up' };
  }
}
