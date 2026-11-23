import { RedisConfigService } from '../../configs/redis-config/redis-config.service';
import { RedisService } from './redis.service';

const client = {
  on: jest.fn(),
  ping: jest.fn(),
  quit: jest.fn(),
  disconnect: jest.fn(),
};
const RedisMock = jest.fn((..._args: unknown[]) => client);

jest.mock('ioredis', () => ({ Redis: jest.fn((...args: unknown[]) => RedisMock(...args)) }));

describe('RedisService', () => {
  const config = { url: 'redis://localhost:6389/0' } as RedisConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('connects to REDIS_URL with a bounded retry', () => {
    new RedisService(config);

    expect(RedisMock).toHaveBeenCalledWith('redis://localhost:6389/0', { maxRetriesPerRequest: 2 });
  });

  it('is healthy when PING answers', async () => {
    client.ping.mockResolvedValue('PONG');

    await expect(new RedisService(config).isHealthy()).resolves.toBe(true);
  });

  it('is unhealthy instead of throwing when Redis is down', async () => {
    client.ping.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(new RedisService(config).isHealthy()).resolves.toBe(false);
  });

  it('quits on shutdown, disconnecting when quit fails', async () => {
    client.quit.mockRejectedValue(new Error('closed'));

    await new RedisService(config).onModuleDestroy();

    expect(client.disconnect).toHaveBeenCalled();
  });
});
