import { Logger } from '@nestjs/common';
import { createClient } from 'redis';
import { RedisConfigService } from '../../configs/redis-config/redis-config.service';
import { createMock } from '../../test/create-mock';
import { RedisService } from './redis.service';

jest.mock('redis', () => ({ createClient: jest.fn() }));

describe('RedisService', () => {
  let client: Record<string, jest.Mock | boolean>;
  let multi: { hSet: jest.Mock; expire: jest.Mock; exec: jest.Mock };
  let service: RedisService;
  const options = { socket: { host: 'redis', port: 6390 } };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    multi = { hSet: jest.fn(), expire: jest.fn(), exec: jest.fn().mockResolvedValue([]) };
    multi.hSet.mockReturnValue(multi);
    multi.expire.mockReturnValue(multi);

    client = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      isOpen: true,
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn(),
      ttl: jest.fn(),
      del: jest.fn(),
      hGetAll: jest.fn(),
      hIncrBy: jest.fn(),
      multi: jest.fn().mockReturnValue(multi),
      scanIterator: jest.fn(),
    };
    (createClient as jest.Mock).mockReturnValue(client);

    service = new RedisService(createMock<RedisConfigService>({ config: () => options }));
  });

  it('creates the client from config and logs client errors', () => {
    expect(createClient).toHaveBeenCalledWith(options);
    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));

    const onError = (client.on as jest.Mock).mock.calls[0][1];
    onError(new Error('lost'));
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('connects', async () => {
    await service.connect();
    expect(client.connect).toHaveBeenCalled();
  });

  describe('onModuleDestroy', () => {
    it('quits an open connection', async () => {
      await service.onModuleDestroy();
      expect(client.quit).toHaveBeenCalled();
    });

    it('does nothing when already closed', async () => {
      client.isOpen = false;
      await service.onModuleDestroy();
      expect(client.quit).not.toHaveBeenCalled();
    });
  });

  describe('set', () => {
    it('sets with an expiry', async () => {
      await service.set('k', 'v', 10);
      expect(client.set).toHaveBeenCalledWith('k', 'v', { EX: 10 });
    });

    it('sets without an expiry', async () => {
      await service.set('k', 'v');
      expect(client.set).toHaveBeenCalledWith('k', 'v', undefined);
    });
  });

  describe('setIfNotExists', () => {
    it('is true when the key was set', async () => {
      await expect(service.setIfNotExists('k', 'v', 5)).resolves.toBe(true);
      expect(client.set).toHaveBeenCalledWith('k', 'v', { EX: 5, NX: true });
    });

    it('is false when the key already existed', async () => {
      (client.set as jest.Mock).mockResolvedValue(null);
      await expect(service.setIfNotExists('k', 'v', 5)).resolves.toBe(false);
    });
  });

  it('gets, reads ttl and hashes', async () => {
    (client.get as jest.Mock).mockResolvedValue('v');
    (client.ttl as jest.Mock).mockResolvedValue(7);
    (client.hGetAll as jest.Mock).mockResolvedValue({ a: '1' });
    (client.hIncrBy as jest.Mock).mockResolvedValue(3);

    await expect(service.get('k')).resolves.toBe('v');
    await expect(service.ttl('k')).resolves.toBe(7);
    await expect(service.hgetall('h')).resolves.toEqual({ a: '1' });
    await expect(service.hincrby('h', 'a', 1)).resolves.toBe(3);
    expect(client.hIncrBy).toHaveBeenCalledWith('h', 'a', 1);
  });

  describe('delete', () => {
    it('deletes keys', async () => {
      (client.del as jest.Mock).mockResolvedValue(2);
      await expect(service.delete(['a', 'b'])).resolves.toBe(2);
    });

    it('skips the round trip for an empty list (DEL with no keys is an error)', async () => {
      await expect(service.delete([])).resolves.toBe(0);
      expect(client.del).not.toHaveBeenCalled();
    });
  });

  describe('hset', () => {
    it('sets the fields and the expiry atomically', async () => {
      await service.hset('h', { a: 1 }, 30);

      expect(multi.hSet).toHaveBeenCalledWith('h', { a: 1 });
      expect(multi.expire).toHaveBeenCalledWith('h', 30);
      expect(multi.exec).toHaveBeenCalled();
    });

    it('does not expire without a ttl', async () => {
      await service.hset('h', { a: 1 });
      expect(multi.expire).not.toHaveBeenCalled();
    });
  });

  it('collects every key yielded by SCAN', async () => {
    (client.scanIterator as jest.Mock).mockImplementation(async function* () {
      yield 'auth:a';
      yield 'auth:b';
    });

    await expect(service.scanKeys('auth:*')).resolves.toEqual(['auth:a', 'auth:b']);
    expect(client.scanIterator).toHaveBeenCalledWith({ MATCH: 'auth:*', COUNT: 100 });
  });
});
