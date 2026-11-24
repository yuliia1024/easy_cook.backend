import { ThrottlerOptions, ThrottlerStorage } from '@nestjs/throttler';
import { RateLimitName } from '../../../common/constants';
import { buildUser } from '../../../test/fixtures';
import { httpContext } from '../../../test/http-context';
import { RateLimit } from './rate-limit.decorator';
import { rateLimitOptions } from './rate-limit.options';

class Routes {
  @RateLimit(RateLimitName.SignIn)
  signIn(): void {}

  @RateLimit(RateLimitName.Llm)
  chat(): void {}

  plain(): void {}
}

describe('rateLimitOptions', () => {
  const storage = {} as ThrottlerStorage;
  const options = rateLimitOptions(storage) as { storage: unknown; throttlers: ThrottlerOptions[] };
  const throttler = (name: RateLimitName) => options.throttlers.find((t) => t.name === name)!;
  const signedIn = httpContext({ authSession: { user: buildUser(), tokenHash: 'h' } });
  const anonymous = httpContext({});
  const route = (handler: keyof Routes) => httpContext({}, Routes.prototype[handler]);

  it('counts in the given storage', () => {
    expect(options.storage).toBe(storage);
  });

  it('allows 300 requests a minute signed in, 60 otherwise, on every route', () => {
    const limit = throttler(RateLimitName.Default).limit as (c: unknown) => number;

    expect(throttler(RateLimitName.Default).ttl).toBe(60_000);
    expect(limit(signedIn)).toBe(300);
    expect(limit(anonymous)).toBe(60);
    expect(throttler(RateLimitName.Default).skipIf).toBeUndefined();
  });

  it('allows 3 sign-ins per 15 minutes, blocking for 30, on the sign-in route only', () => {
    const signIn = throttler(RateLimitName.SignIn);

    expect(signIn).toMatchObject({ ttl: 15 * 60_000, limit: 3, blockDuration: 30 * 60_000 });
    expect(signIn.skipIf!(route('signIn'))).toBe(false);
    expect(signIn.skipIf!(route('chat'))).toBe(true);
    expect(signIn.skipIf!(route('plain'))).toBe(true);
  });

  it('allows 5 model calls a minute, on the chat route only', () => {
    const llm = throttler(RateLimitName.Llm);

    expect(llm).toMatchObject({ ttl: 60_000, limit: 5 });
    expect(llm.skipIf!(route('chat'))).toBe(false);
    expect(llm.skipIf!(route('signIn'))).toBe(true);
  });

  it('blocks an anonymous client for an hour, a signed-in one for 5 minutes', () => {
    for (const name of [RateLimitName.Default, RateLimitName.Llm]) {
      const { blockDuration } = throttler(name);
      const block = blockDuration as (c: unknown) => number;
      expect(block(anonymous)).toBe(60 * 60_000);
      expect(block(signedIn)).toBe(5 * 60_000);
    }
  });
});
