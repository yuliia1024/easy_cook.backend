import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma } from '../../generated/prisma/client';
import { ConfigService } from '../config.service';

@Injectable()
export class DatabaseConfigService {
  constructor(private readonly configService: ConfigService) {}

  public get url(): string {
    return this.configService.get('DATABASE_URL');
  }

  /** Prisma 7 talks to Postgres through the `pg` driver adapter. */
  public config(): Prisma.PrismaClientOptions {
    return {
      adapter: new PrismaPg({ connectionString: this.url }),
      log: this.configService.getBoolean('POSTGRES_LOGGING')
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
    };
  }
}
