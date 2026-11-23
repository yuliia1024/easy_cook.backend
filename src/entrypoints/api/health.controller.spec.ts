import { DatabaseUnavailableException, RedisUnavailableException } from '../../common/exceptions';
import { PrismaService } from '../../providers/prisma/prisma.service';
import { RedisService } from '../../providers/redis/redis.service';
import { createMock } from '../../test/create-mock';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let prisma: jest.Mocked<PrismaService>;
  let redis: jest.Mocked<RedisService>;
  let controller: HealthController;

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    redis = createMock<RedisService>();
    redis.isHealthy.mockResolvedValue(true);
    controller = new HealthController(prisma, redis);
  });

  it('reports ok with the database and Redis up', async () => {
    prisma.isHealthy.mockResolvedValue(true);

    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      database: 'up',
      redis: 'up',
    });
  });

  it('answers 503 when Redis is down', async () => {
    prisma.isHealthy.mockResolvedValue(true);
    redis.isHealthy.mockResolvedValue(false);

    await expect(controller.check()).rejects.toBeInstanceOf(RedisUnavailableException);
  });

  it('is public', () => {
    expect(Reflect.getMetadata('isPublic', HealthController)).toBe(true);
  });

  it('answers 503 when the database is down', async () => {
    prisma.isHealthy.mockResolvedValue(false);

    await expect(controller.check()).rejects.toBeInstanceOf(DatabaseUnavailableException);
  });

  it('is not rate limited', () => {
    expect(Reflect.getMetadata('THROTTLER:SKIPdefault', HealthController)).toBe(true);
  });
});
