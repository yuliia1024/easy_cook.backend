import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthenticatedRequest } from '../auth/current-session.decorator';
import { rateLimitKey, rateLimitTracker } from './rate-limit.key';

/** The rate limits per client (`rateLimitTracker`), keyed by `rateLimitKey`. */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    return rateLimitTracker(req as unknown as AuthenticatedRequest);
  }

  protected generateKey(_context: ExecutionContext, tracker: string, name: string): string {
    return rateLimitKey(name, tracker);
  }
}
