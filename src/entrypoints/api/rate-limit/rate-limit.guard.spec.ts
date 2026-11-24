import { Reflector } from '@nestjs/core';
import { ThrottlerStorage } from '@nestjs/throttler';
import { buildUser } from '../../../test/fixtures';
import { httpContext } from '../../../test/http-context';
import { RateLimitGuard } from './rate-limit.guard';
import { rateLimitKey } from './rate-limit.key';

class TestableGuard extends RateLimitGuard {
  public tracker(req: Record<string, unknown>): Promise<string> {
    return this.getTracker(req);
  }

  public key(tracker: string, name: string): string {
    return this.generateKey(httpContext({}), tracker, name);
  }
}

describe('RateLimitGuard', () => {
  const guard = new TestableGuard({ throttlers: [] }, {} as ThrottlerStorage, new Reflector());

  it('tracks a client by its email or its ip', async () => {
    const signedIn = { ip: '1.2.3.4', authSession: { user: buildUser(), tokenHash: 'h' } };

    await expect(guard.tracker(signedIn)).resolves.toBe('user:cook@example.com');
    await expect(guard.tracker({ ip: '1.2.3.4' })).resolves.toBe('ip:1.2.3.4');
  });

  it('keys by rateLimitKey', () => {
    expect(guard.key('ip:1.2.3.4', 'llm')).toBe(rateLimitKey('llm', 'ip:1.2.3.4'));
  });
});
