import { Global, Module } from '@nestjs/common';
import { RedisConfigService } from '../../configs/redis-config/redis-config.service';
import { REDIS_SERVICE, RedisService } from './redis.service';

const redisServiceProvider = {
  provide: REDIS_SERVICE,
  useFactory: async (configService: RedisConfigService): Promise<RedisService> => {
    const redisService = new RedisService(configService);
    await redisService.connect();
    return redisService;
  },
  inject: [RedisConfigService],
};

@Global()
@Module({
  providers: [redisServiceProvider],
  exports: [REDIS_SERVICE],
})
export class RedisModule {}
