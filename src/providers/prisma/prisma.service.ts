import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '../../generated/prisma/client';
import { DatabaseConfigService } from '../../configs/database-config/database-config.service';

/** The one Prisma client of the app. Repositories in `modules/data-access` are its only users. */
@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query' | 'warn' | 'error'>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(databaseConfig: DatabaseConfigService) {
    super(databaseConfig.config());
    // SQL is debug-level: visible with `LOG_LEVEL=debug`, tagged with the request that ran it.
    this.$on('query', (event) => this.logger.debug(PrismaService.describeQuery(event)));
    this.$on('warn', (event) => this.logger.warn(event.message));
    this.$on('error', (event) => this.logger.error(event.message));
  }

  /** `SELECT ... WHERE "id" = $1 [42] 3ms` */
  private static describeQuery({ query, params, duration }: Prisma.QueryEvent): string {
    const values = params && params !== '[]' ? ` ${params}` : '';
    return `${query}${values} ${Math.round(duration)}ms`;
  }

  public async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Postgres connected');
  }

  public async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** `SELECT 1`; false instead of throwing when the database cannot be reached. */
  public async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error('Postgres health check failed', (error as Error)?.stack);
      return false;
    }
  }
}
