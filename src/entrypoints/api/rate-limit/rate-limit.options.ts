import { ExecutionContext } from '@nestjs/common';
import { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { RATE_LIMIT_BLOCK_MS, RATE_LIMITS, RateLimitName } from '../../../common/constants';
import { AuthenticatedRequest } from '../auth/current-session.decorator';
import { RATE_LIMIT_KEY } from './rate-limit.decorator';

/** `SessionGuard` ran before the limits: a request with a live session carries it. */
export function isSignedIn(context: ExecutionContext): boolean {
  return context.switchToHttp().getRequest<AuthenticatedRequest>().authSession !== undefined;
}

/** A named limit applies only to the routes marked with it. */
const onlyOn =
  (name: RateLimitName): ((context: ExecutionContext) => boolean) =>
  (context: ExecutionContext): boolean =>
    Reflect.getMetadata(RATE_LIMIT_KEY, context.getHandler()) !== name;

/**
 * The limits of `RATE_LIMITS`, blocking per `RATE_LIMIT_BLOCK_MS` (a sign-in per its own `blockMs`),
 * counted in `storage`.
 */
export function rateLimitOptions(storage: ThrottlerStorage): ThrottlerModuleOptions {
  const blockDuration = (context: ExecutionContext): number =>
    isSignedIn(context) ? RATE_LIMIT_BLOCK_MS.signedIn : RATE_LIMIT_BLOCK_MS.anonymous;
  const defaults = RATE_LIMITS[RateLimitName.Default];
  const signIn = RATE_LIMITS[RateLimitName.SignIn];
  const llm = RATE_LIMITS[RateLimitName.Llm];

  return {
    storage,
    throttlers: [
      {
        name: RateLimitName.Default,
        ttl: defaults.ttlMs,
        limit: (context) => (isSignedIn(context) ? defaults.signedIn : defaults.anonymous),
        blockDuration,
      },
      {
        name: RateLimitName.SignIn,
        ttl: signIn.ttlMs,
        limit: signIn.limit,
        blockDuration: signIn.blockMs,
        skipIf: onlyOn(RateLimitName.SignIn),
      },
      {
        name: RateLimitName.Llm,
        ttl: llm.ttlMs,
        limit: llm.limit,
        blockDuration,
        skipIf: onlyOn(RateLimitName.Llm),
      },
    ],
  };
}
