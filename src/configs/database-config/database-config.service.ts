import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma } from '../../generated/prisma/client';
import { Environments } from '../../common/types';
import { ConfigService } from '../config.service';

@Injectable()
export class DatabaseConfigService {
  constructor(private readonly configService: ConfigService) {}

  public get url(): string {
    return this.configService.get('DATABASE_URL');
  }

  /**
   * The values of logged queries (`LOG_LEVEL=debug`) only with `ENV=local`: they hold what the
   * user wrote, which stays out of shared logs.
   */
  public get logsQueryParams(): boolean {
    return this.configService.get('ENV') === Environments.LOCAL;
  }

  /**
   * Prisma 7 talks to Postgres through the `pg` driver adapter. Its logs are emitted as events so
   * `PrismaService` can pass them to the app logger (level filter, request id).
   */
  public config(): Prisma.PrismaClientOptions {
    return {
      adapter: new PrismaPg({ connectionString: this.url }),
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    };
  }
}
