/** The session cookie; `__Host-` (Secure, no Domain, Path=/) is prepended when the cookie is Secure. */
export const SESSION_COOKIE_NAME = 'ec_session';
export const SECURE_COOKIE_PREFIX = '__Host-';

/** The one-time nonce of a Google sign-in, bound to the browser that asked for it. */
export const LOGIN_NONCE_COOKIE_NAME = 'ec_login_nonce';
export const LOGIN_NONCE_TTL_SECONDS = 10 * 60;
export const LOGIN_NONCE_BYTES = 32;

/** Signed-in devices per user; a new sign-in beyond it ends the oldest session. */
export const MAX_SESSIONS_PER_USER = 10;

/** Sent by the web app on every unsafe request; the value comes with the session (`csrfToken`). */
export const CSRF_HEADER = 'x-csrf-token';

/** A session nobody used for this long ends. */
export const SESSION_IDLE_TTL_SECONDS = 7 * 24 * 60 * 60;
/** A session ends this long after the sign-in, used or not. */
export const SESSION_ABSOLUTE_TTL_SECONDS = 14 * 24 * 60 * 60;
/** How often a used session moves its idle expiry (one Redis write per interval, not per request). */
export const SESSION_TOUCH_INTERVAL_SECONDS = 5 * 60;
/** Random bytes of a session token. */
export const SESSION_TOKEN_BYTES = 32;

export const REDIS_KEYS = {
  session: (tokenHash: string): string => `auth:session:${tokenHash}`,
  /** Sorted set of the session hashes of a user, scored by sign-in time. */
  userSessions: (userId: string): string => `auth:user-sessions:${userId}`,
  loginNonce: (nonceHash: string): string => `auth:login-nonce:${nonceHash}`,
};

/** The issuers of a Google ID token. */
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/** Methods that change nothing: no CSRF token or origin check. */
export const SAFE_HTTP_METHODS = ['GET', 'HEAD', 'OPTIONS'];

export enum CookieSameSite {
  Lax = 'lax',
  Strict = 'strict',
  None = 'none',
}

export const DEFAULT_COOKIE_SAME_SITE = CookieSameSite.Strict;
export const MIN_AUTH_SECRET_LENGTH = 32;
export const MAX_ID_TOKEN_LENGTH = 4096;
export const MAX_USER_AGENT_LENGTH = 512;
