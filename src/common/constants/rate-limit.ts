/**
 * The rate limits (`ThrottlerModule`, Redis). A signed-in client is counted by its email, any other
 * by its IP (an IPv6 one by its /64); past a limit it is blocked from that limit for
 * `RATE_LIMIT_BLOCK_MS`, a sign-in for `RATE_LIMITS.sign_in.blockMs`.
 */
export enum RateLimitName {
  Default = 'default',
  SignIn = 'sign_in',
  Llm = 'llm',
}

/**
 * `sign_in` counts the failed sign-ins only: a successful one forgets the attempts before it
 * (`RedisThrottlerStorage.forget`).
 */
export const RATE_LIMITS = {
  [RateLimitName.Default]: { ttlMs: 60_000, signedIn: 300, anonymous: 60 },
  [RateLimitName.SignIn]: { ttlMs: 15 * 60_000, limit: 3, blockMs: 30 * 60_000 },
  [RateLimitName.Llm]: { ttlMs: 60_000, limit: 5 },
};

export const RATE_LIMIT_BLOCK_MS = {
  signedIn: 5 * 60_000,
  anonymous: 60 * 60_000,
};

export const RATE_LIMIT_REDIS_KEY = (key: string): string => `throttle:${key}`;
