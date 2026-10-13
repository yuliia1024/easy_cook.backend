import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client';
import { DatabaseConfigService } from '../../configs/database-config/database-config.service';

/** The one Prisma client of the app. Repositories in `modules/data-access` are its only users. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(databaseConfig: DatabaseConfigService) {
    super(databaseConfig.config());
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
