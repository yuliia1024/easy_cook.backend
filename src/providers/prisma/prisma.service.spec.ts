import { Logger } from '@nestjs/common';
import { fakeConfig } from '../../test/fake-config';
import { DatabaseConfigService } from '../../configs/database-config/database-config.service';
import { PrismaService } from './prisma.service';

describe('OpenAiService', () => {
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

  describe('logs', () => {
    type On = (event: string, callback: (payload: object) => void) => void;

    const captured = new Map<string, (payload: object) => void>();
    const emit = (event: string, payload: object): void => captured.get(event)?.(payload);

    beforeEach(() => {
      jest.spyOn(Logger.prototype, 'debug').mockImplementation();
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      jest
        .spyOn(PrismaService.prototype as unknown as { $on: On }, '$on')
        .mockImplementation((event, callback) => {
          captured.set(event, callback);
        });
      service = new PrismaService(
        new DatabaseConfigService(fakeConfig({ DATABASE_URL: 'postgresql://u:p@localhost:1/d' })),
      );
    });

    it('prints queries at debug with their params and rounded duration', () => {
      emit('query', { query: 'SELECT 1 WHERE "id" = $1', params: '[42]', duration: 3.47 });

      expect(Logger.prototype.debug).toHaveBeenCalledWith('SELECT 1 WHERE "id" = $1 [42] 3ms');
    });

    it('leaves out empty params', () => {
      emit('query', { query: 'SELECT 1', params: '[]', duration: 0 });

      expect(Logger.prototype.debug).toHaveBeenCalledWith('SELECT 1 0ms');
    });

    it('forwards warnings and errors', () => {
      emit('warn', { message: 'slow' });
      emit('error', { message: 'broken' });

      expect(Logger.prototype.warn).toHaveBeenCalledWith('slow');
      expect(Logger.prototype.error).toHaveBeenCalledWith('broken');
    });
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
