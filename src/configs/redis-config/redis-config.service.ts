import { Injectable } from '@nestjs/common';
import { RedisClientOptions } from 'redis';
import { ConfigService } from '../config.service';

@Injectable()
export class RedisConfigService {
  constructor(private readonly configService: ConfigService) {}

  public config(): RedisClientOptions {
    return {
      socket: {
        host: this.configService.get('REDIS_HOST'),
        port: this.configService.getNumber('REDIS_PORT'),
      },
      password: this.configService.get('REDIS_PASSWORD') || undefined,
      database: this.configService.getNumber('REDIS_DB') || 0,
    };
  }
}
