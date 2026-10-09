import { fakeConfig } from '../../test/fake-config';
import { RedisConfigService } from './redis-config.service';

describe('RedisConfigService', () => {
  it('builds client options', () => {
    const service = new RedisConfigService(
      fakeConfig({
        REDIS_HOST: 'redis',
        REDIS_PORT: '6390',
        REDIS_PASSWORD: 'secret',
        REDIS_DB: '2',
      }),
    );

    expect(service.config()).toEqual({
      socket: { host: 'redis', port: 6390 },
      password: 'secret',
      database: 2,
    });
  });

  it('omits an empty password and defaults to db 0', () => {
    const config = new RedisConfigService(
      fakeConfig({ REDIS_HOST: 'redis', REDIS_PORT: '6390', REDIS_PASSWORD: '' }),
    ).config();

    expect(config.password).toBeUndefined();
    expect(config.database).toBe(0);
  });
});
