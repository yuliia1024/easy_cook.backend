import { createHash } from 'node:crypto';
import { buildUser } from '../../../test/fixtures';
import { AuthenticatedRequest } from '../auth/current-session.decorator';
import { rateLimitKey, rateLimitTracker } from './rate-limit.key';

const request = (fields: Record<string, unknown>): AuthenticatedRequest =>
  fields as unknown as AuthenticatedRequest;

describe('rateLimitTracker', () => {
  it('counts a signed-in client by its email', () => {
    const signedIn = request({ ip: '1.2.3.4', authSession: { user: buildUser(), tokenHash: 'h' } });

    expect(rateLimitTracker(signedIn)).toBe('user:cook@example.com');
  });

  it('counts any other client by its ip', () => {
    expect(rateLimitTracker(request({ ip: '1.2.3.4' }))).toBe('ip:1.2.3.4');
    expect(rateLimitTracker(request({}))).toBe('ip:unknown');
  });

  it('counts an IPv6 client by its /64, whatever address of it it uses', () => {
    const first = rateLimitTracker(request({ ip: '2001:db8:1:2::1' }));

    expect(first).toBe('ip:2001:db8:1:2::/64');
    expect(rateLimitTracker(request({ ip: '2001:db8:1:2:ffff::9' }))).toBe(first);
    expect(rateLimitTracker(request({ ip: '2001:db8:1:3::1' }))).not.toBe(first);
  });
});

describe('rateLimitKey', () => {
  it('keys a limit by its name and the client only, hashed', () => {
    const key = rateLimitKey('default', 'user:cook@example.com');

    expect(key).toBe(createHash('sha256').update('default:user:cook@example.com').digest('hex'));
    expect(key).not.toContain('cook');
    expect(rateLimitKey('llm', 'user:cook@example.com')).not.toBe(key);
  });
});
