import { DatabaseUnavailableException } from '../../common/exceptions';
import { PrismaService } from '../../providers/prisma/prisma.service';
import { createMock } from '../../test/create-mock';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let prisma: jest.Mocked<PrismaService>;
  let controller: HealthController;

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    controller = new HealthController(prisma);
  });

  it('reports ok with the database up', async () => {
    prisma.isHealthy.mockResolvedValue(true);

    await expect(controller.check()).resolves.toEqual({ status: 'ok', database: 'up' });
  });

  it('answers 503 when the database is down', async () => {
    prisma.isHealthy.mockResolvedValue(false);

    await expect(controller.check()).rejects.toBeInstanceOf(DatabaseUnavailableException);
  });

  it('is not rate limited', () => {
    expect(Reflect.getMetadata('THROTTLER:SKIPdefault', HealthController)).toBe(true);
  });
});
