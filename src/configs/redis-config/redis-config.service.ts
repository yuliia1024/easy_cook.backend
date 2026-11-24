import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config.service';

@Injectable()
export class RedisConfigService {
  constructor(private readonly configService: ConfigService) {}

  public get url(): string {
    return this.configService.get('REDIS_URL');
  }
}
