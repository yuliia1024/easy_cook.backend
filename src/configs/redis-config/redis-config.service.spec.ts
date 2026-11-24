import { fakeConfig } from '../../test/fake-config';
import { RedisConfigService } from './redis-config.service';

describe('RedisConfigService', () => {
  it('exposes REDIS_URL', () => {
    const url = 'redis://localhost:6389/0';

    expect(new RedisConfigService(fakeConfig({ REDIS_URL: url })).url).toBe(url);
  });
});
