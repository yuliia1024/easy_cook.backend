/** What a verified Google ID token says about the account. */
export interface GoogleIdentity {
  /** The Google account id. */
  sub: string;
  /** Lower case. */
  email: string;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
  /** The `nonce` claim: the one the web app passed to Google for this sign-in. */
  nonce: string | null;
}

/** A session as stored in Redis, under the sha256 of its token. */
export interface StoredSession {
  userId: string;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms of the last request that moved the idle expiry. */
  lastSeenAt: number;
  userAgent: string | null;
}
