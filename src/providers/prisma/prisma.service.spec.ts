import { Logger } from '@nestjs/common';
import { fakeConfig } from '../../test/fake-config';
import { DatabaseConfigService } from '../../configs/database-config/database-config.service';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    service = new PrismaService(
      new DatabaseConfigService(fakeConfig({ DATABASE_URL: 'postgresql://u:p@localhost:1/d' })),
    );
  });

  it('connects on start-up and disconnects on shutdown', async () => {
    const connect = jest.spyOn(service, '$connect').mockResolvedValue();
    const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue();

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(connect).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });

  describe('isHealthy', () => {
    it('is true when SELECT 1 succeeds', async () => {
      jest.spyOn(service, '$queryRaw').mockResolvedValue([{ '?column?': 1 }] as never);

      await expect(service.isHealthy()).resolves.toBe(true);
    });

    it('is false and logs when the query fails', async () => {
      jest.spyOn(service, '$queryRaw').mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.isHealthy()).resolves.toBe(false);
      expect(Logger.prototype.error).toHaveBeenCalled();
    });
  });
});
