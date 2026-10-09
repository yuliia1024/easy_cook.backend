import { TokenType } from '../../../common/constants';
import { RedisService } from '../../../providers/redis/redis.service';
import { createMock } from '../../../test/create-mock';
import { SESSION_ID, USER_ID } from '../../../test/fixtures';
import { AuthStorageService } from './auth-storage.service';

describe('AuthStorageService', () => {
  let redis: jest.Mocked<RedisService>;
  let service: AuthStorageService;
  const accessKey = `auth:access:${USER_ID}:${SESSION_ID}`;
  const refreshKey = `auth:refresh:${USER_ID}:${SESSION_ID}`;

  beforeEach(() => {
    redis = createMock<RedisService>();
    service = new AuthStorageService(redis);
  });

  it('stores both tokens of a session with their own lifetimes', async () => {
    await service.save(USER_ID, SESSION_ID, {
      accessToken: 'a',
      accessExpiresInSec: 900,
      refreshToken: 'r',
      refreshExpiresInSec: 86400,
    });

    expect(redis.set).toHaveBeenCalledWith(accessKey, 'a', 900);
    expect(redis.set).toHaveBeenCalledWith(refreshKey, 'r', 86400);
  });

  it.each([
    [TokenType.Access, accessKey],
    [TokenType.Refresh, refreshKey],
  ])('reads the %s token', async (type, key) => {
    redis.get.mockResolvedValue('token');

    await expect(service.get(type, USER_ID, SESSION_ID)).resolves.toBe('token');
    expect(redis.get).toHaveBeenCalledWith(key);
  });

  it('deletes one session', async () => {
    await service.deleteSession(USER_ID, SESSION_ID);

    expect(redis.delete).toHaveBeenCalledWith([accessKey, refreshKey]);
  });

  describe('deleteAllSessions', () => {
    const other = 'other-session';
    const keys = [
      accessKey,
      refreshKey,
      `auth:access:${USER_ID}:${other}`,
      `auth:refresh:${USER_ID}:${other}`,
    ];

    beforeEach(() => redis.scanKeys.mockResolvedValue(keys));

    it('deletes every session of the user', async () => {
      await service.deleteAllSessions(USER_ID);

      expect(redis.scanKeys).toHaveBeenCalledWith(`auth:*:${USER_ID}:*`);
      expect(redis.delete).toHaveBeenCalledWith(keys);
    });

    it('keeps the excepted session', async () => {
      await service.deleteAllSessions(USER_ID, SESSION_ID);

      expect(redis.delete).toHaveBeenCalledWith([
        `auth:access:${USER_ID}:${other}`,
        `auth:refresh:${USER_ID}:${other}`,
      ]);
    });
  });
});
