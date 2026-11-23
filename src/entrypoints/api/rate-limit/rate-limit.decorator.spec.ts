import { RateLimitName } from '../../../common/constants';
import { RATE_LIMIT_KEY, RateLimit } from './rate-limit.decorator';

class Routes {
  @RateLimit(RateLimitName.Llm)
  chat(): void {}

  plain(): void {}
}

describe('RateLimit', () => {
  it('puts a route under the named limit', () => {
    expect(Reflect.getMetadata(RATE_LIMIT_KEY, Routes.prototype.chat)).toBe(RateLimitName.Llm);
    expect(Reflect.getMetadata(RATE_LIMIT_KEY, Routes.prototype.plain)).toBeUndefined();
  });
});
