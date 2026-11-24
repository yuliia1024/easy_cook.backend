import { normalizeIp } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { RateLimitName } from '../../../common/constants';
import { AuthenticatedRequest } from '../auth/current-session.decorator';

/**
 * Who a request is counted as: a signed-in client by its email (every session, every device of
 * the user together), any other by its IP, an IPv6 one by its /64 (one host has the whole subnet).
 */
export function rateLimitTracker(request: AuthenticatedRequest): string {
  const email = request.authSession?.user.email;
  if (email) {
    return `user:${email}`;
  }
  return request.ip ? `ip:${normalizeIp(request.ip)}` : 'ip:unknown';
}

/**
 * The key of a limit for a client: one count across all the routes of the limit, hashed (no email
 * or IP is stored in Redis).
 */
export function rateLimitKey(name: RateLimitName | string, tracker: string): string {
  return createHash('sha256').update(`${name}:${tracker}`).digest('hex');
}
