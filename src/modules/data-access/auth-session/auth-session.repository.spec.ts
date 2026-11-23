import { RedisService } from '../../../providers/redis/redis.service';
import { AuthSessionRepository } from './auth-session.repository';

function createRedis(): {
  redis: RedisService;
  client: Record<string, jest.Mock>;
  transaction: Record<string, jest.Mock>;
} {
  const transaction: Record<string, jest.Mock> = {};
  for (const command of ['set', 'zadd', 'expire', 'del', 'zrem']) {
    transaction[command] = jest.fn(() => transaction);
  }
  transaction.exec = jest.fn().mockResolvedValue([]);
  const client = {
    multi: jest.fn(() => transaction),
    get: jest.fn(),
    set: jest.fn(),
    getdel: jest.fn(),
    eval: jest.fn(),
  };
  return { redis: { client } as unknown as RedisService, client, transaction };
}

describe('AuthSessionRepository', () => {
  const session = { userId: 'u1', createdAt: 1, lastSeenAt: 2, userAgent: 'Firefox' };

  it('creates the session with its ttl and adds it to the sessions of the user', async () => {
    const { redis, transaction } = createRedis();

    await new AuthSessionRepository(redis).create('hash', session, 600);

    expect(transaction.set).toHaveBeenCalledWith(
      'auth:session:hash',
      JSON.stringify(session),
      'EX',
      600,
      'NX',
    );
    expect(transaction.zadd).toHaveBeenCalledWith('auth:user-sessions:u1', 1, 'hash');
    expect(transaction.expire).toHaveBeenCalledWith('auth:user-sessions:u1', 14 * 24 * 60 * 60);
    expect(transaction.exec).toHaveBeenCalled();
  });

  it('finds a session, null when missing or unreadable', async () => {
    const { redis, client } = createRedis();
    const repository = new AuthSessionRepository(redis);

    client.get.mockResolvedValueOnce(JSON.stringify(session));
    await expect(repository.find('hash')).resolves.toEqual(session);
    expect(client.get).toHaveBeenCalledWith('auth:session:hash');

    client.get.mockResolvedValueOnce(null);
    await expect(repository.find('hash')).resolves.toBeNull();

    client.get.mockResolvedValueOnce('{oops');
    await expect(repository.find('hash')).resolves.toBeNull();
  });

  it('touches only a session that still exists', async () => {
    const { redis, client } = createRedis();

    await new AuthSessionRepository(redis).touch('hash', session, 300);

    expect(client.set).toHaveBeenCalledWith(
      'auth:session:hash',
      JSON.stringify(session),
      'EX',
      300,
      'XX',
    );
  });

  it('deletes one session', async () => {
    const { redis, transaction } = createRedis();

    await new AuthSessionRepository(redis).delete('hash', 'u1');

    expect(transaction.del).toHaveBeenCalledWith('auth:session:hash');
    expect(transaction.zrem).toHaveBeenCalledWith('auth:user-sessions:u1', 'hash');
  });

  it('trims the live sessions beyond the limit in one script', async () => {
    const { redis, client } = createRedis();

    await new AuthSessionRepository(redis).trimUserSessions('u1', 10);

    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('EXISTS'"),
      1,
      'auth:user-sessions:u1',
      10,
      'auth:session:',
    );
  });

  it('saves a login nonce with its ttl and consumes it once', async () => {
    const { redis, client } = createRedis();
    const repository = new AuthSessionRepository(redis);

    await repository.saveLoginNonce('n', 600);
    expect(client.set).toHaveBeenCalledWith('auth:login-nonce:n', '1', 'EX', 600);

    client.getdel.mockResolvedValueOnce('1').mockResolvedValueOnce(null);
    await expect(repository.consumeLoginNonce('n')).resolves.toBe(true);
    await expect(repository.consumeLoginNonce('n')).resolves.toBe(false);
    expect(client.getdel).toHaveBeenCalledWith('auth:login-nonce:n');
  });
});
