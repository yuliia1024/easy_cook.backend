import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { SESSION_TOKEN_BYTES } from '../constants';

/** base64url of `SESSION_TOKEN_BYTES` bytes. */
const SESSION_TOKEN_PATTERN = new RegExp(
  `^[A-Za-z0-9_-]{${Math.ceil((SESSION_TOKEN_BYTES * 4) / 3)}}$`,
);

/** A fresh, unguessable token: a session (the cookie value) or a login nonce. */
export function generateSecureToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

/** A value that cannot be one of our tokens: no need to ask Redis. */
export function isSecureTokenShaped(value: unknown): value is string {
  return typeof value === 'string' && SESSION_TOKEN_PATTERN.test(value);
}

/** sha256 hex: what a session or a nonce is stored under. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The CSRF token of a session: an HMAC of its hash, so it cannot be made without the secret. */
export function csrfTokenFor(tokenHash: string, secret: string): string {
  return createHmac('sha256', secret).update(`csrf:${tokenHash}`).digest('base64url');
}

/** Constant-time string comparison; false for anything but two equal strings. */
export function safeEqual(expected: string, actual: unknown): boolean {
  if (typeof actual !== 'string') {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Constant-time comparison of the token a request sent with the one of its session. */
export function isCsrfTokenValid(tokenHash: string, secret: string, sent: unknown): boolean {
  return safeEqual(csrfTokenFor(tokenHash, secret), sent);
}
