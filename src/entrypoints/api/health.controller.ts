import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { DatabaseUnavailableException } from '../../common/exceptions';
import { PrismaService } from '../../providers/prisma/prisma.service';

@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prismaService: PrismaService) {}

  /** 503 when the database cannot be reached. */
  @Get()
  async check(): Promise<{ status: string; database: string }> {
    if (!(await this.prismaService.isHealthy())) {
      throw new DatabaseUnavailableException();
    }
    return { status: 'ok', database: 'up' };
  }
}
