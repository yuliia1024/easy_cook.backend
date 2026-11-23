import { Injectable, Logger } from '@nestjs/common';
import { User } from '../../../generated/prisma/client';
import {
  LOGIN_NONCE_TTL_SECONDS,
  MAX_SESSIONS_PER_USER,
  MAX_USER_AGENT_LENGTH,
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_IDLE_TTL_SECONDS,
  SESSION_TOUCH_INTERVAL_SECONDS,
} from '../../../common/constants';
import {
  EmailNotAllowedForbiddenException,
  GoogleAccountMismatchForbiddenException,
  LoginNonceUnauthorizedException,
  UnverifiedEmailForbiddenException,
} from '../../../common/exceptions';
import { GoogleIdentity, StoredSession } from '../../../common/types';
import {
  csrfTokenFor,
  generateSecureToken,
  hashToken,
  isCsrfTokenValid,
  isSecureTokenShaped,
  safeEqual,
} from '../../../common/utils';
import { AuthConfigService } from '../../../configs/auth-config/auth-config.service';
import { GoogleIdentityService } from '../../../providers/google/google-identity.service';
import { AuthSessionRepository } from '../../data-access/auth-session/auth-session.repository';
import { UserRepository } from '../../data-access/user/user.repository';

/** A new session: `token` goes into the cookie and nowhere else. */
export interface SignedInSession {
  user: User;
  token: string;
  csrfToken: string;
}

/** The session of a request, checked. */
export interface AuthenticatedSession {
  user: User;
  tokenHash: string;
}

/**
 * Google sign-in and the sessions. A session is a random token in an httpOnly cookie, stored in
 * Redis by its sha256; it ends after `SESSION_IDLE_TTL_SECONDS` unused, at the latest
 * `SESSION_ABSOLUTE_TTL_SECONDS` after the sign-in, or on sign-out. Every sign-in gets a new token
 * (no session fixation). Unsafe requests carry a CSRF token derived from the session.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly googleIdentityService: GoogleIdentityService,
    private readonly userRepository: UserRepository,
    private readonly authSessionRepository: AuthSessionRepository,
    private readonly authConfig: AuthConfigService,
  ) {}

  /**
   * A one-time nonce for the next Google sign-in, valid `LOGIN_NONCE_TTL_SECONDS`. The web app
   * passes it to Google, which puts it into the ID token; the browser also keeps it in a cookie,
   * so a token is accepted once, and only from the browser that started the sign-in.
   */
  public async createLoginNonce(): Promise<string> {
    const nonce = generateSecureToken();
    await this.authSessionRepository.saveLoginNonce(hashToken(nonce), LOGIN_NONCE_TTL_SECONDS);
    return nonce;
  }

  /**
   * Verifies the Google ID token and its nonce (the one in the cookie of this browser, unused),
   * finds or (for an allowed email) creates the user and opens a new session; the session of
   * `previousToken` (the cookie the browser still had) ends, and the oldest beyond
   * `MAX_SESSIONS_PER_USER`.
   */
  public async signInWithGoogle(
    idToken: string,
    cookieNonce: unknown,
    userAgent: string | undefined,
    previousToken?: unknown,
  ): Promise<SignedInSession> {
    const identity = await this.googleIdentityService.verify(idToken);
    await this.consumeLoginNonce(identity.nonce, cookieNonce);
    const user = await this.resolveUser(identity);
    await this.signOut(previousToken);

    const token = generateSecureToken();
    const tokenHash = hashToken(token);
    const now = Date.now();
    const session: StoredSession = {
      userId: user.id,
      createdAt: now,
      lastSeenAt: now,
      userAgent: userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
    };
    await this.authSessionRepository.create(tokenHash, session, SESSION_IDLE_TTL_SECONDS);
    await this.authSessionRepository.trimUserSessions(user.id, MAX_SESSIONS_PER_USER);
    this.logger.log(`User ${user.id} signed in`);

    return { user, token, csrfToken: this.csrfTokenFor(tokenHash) };
  }

  /**
   * The user of a session token; null for a missing, malformed, unknown or ended one. A used session
   * moves its idle expiry (at most once per `SESSION_TOUCH_INTERVAL_SECONDS`), never past the
   * absolute one.
   */
  public async authenticate(token: unknown): Promise<AuthenticatedSession | null> {
    if (!isSecureTokenShaped(token)) {
      return null;
    }
    const tokenHash = hashToken(token);
    const session = await this.authSessionRepository.find(tokenHash);
    if (!session) {
      return null;
    }
    const now = Date.now();
    const absoluteLeftSeconds = Math.floor(
      (session.createdAt + SESSION_ABSOLUTE_TTL_SECONDS * 1000 - now) / 1000,
    );
    const user =
      absoluteLeftSeconds > 0 ? await this.userRepository.findById(session.userId) : null;
    if (!user) {
      await this.authSessionRepository.delete(tokenHash, session.userId);
      return null;
    }
    if (now - session.lastSeenAt >= SESSION_TOUCH_INTERVAL_SECONDS * 1000) {
      await this.authSessionRepository.touch(
        tokenHash,
        { ...session, lastSeenAt: now },
        Math.min(SESSION_IDLE_TTL_SECONDS, absoluteLeftSeconds),
      );
    }
    return { user, tokenHash };
  }

  public csrfTokenFor(tokenHash: string): string {
    return csrfTokenFor(tokenHash, this.authConfig.secret);
  }

  public isCsrfTokenValid(tokenHash: string, sent: unknown): boolean {
    return isCsrfTokenValid(tokenHash, this.authConfig.secret, sent);
  }

  /** Ends the session of the token; nothing for a missing or unknown one. */
  public async signOut(token: unknown): Promise<void> {
    if (!isSecureTokenShaped(token)) {
      return;
    }
    const tokenHash = hashToken(token);
    const session = await this.authSessionRepository.find(tokenHash);
    if (session) {
      await this.authSessionRepository.delete(tokenHash, session.userId);
    }
  }

  /** Ends every session of the user, on every device. */
  public async signOutEverywhere(userId: string): Promise<void> {
    await this.authSessionRepository.deleteAllOfUser(userId);
    this.logger.log(`User ${userId} signed out everywhere`);
  }

  /** 401 unless the token carries the nonce of the cookie and it was issued and not used yet. */
  private async consumeLoginNonce(tokenNonce: string | null, cookieNonce: unknown): Promise<void> {
    if (!isSecureTokenShaped(cookieNonce) || !tokenNonce || !safeEqual(tokenNonce, cookieNonce)) {
      throw new LoginNonceUnauthorizedException();
    }
    if (!(await this.authSessionRepository.consumeLoginNonce(hashToken(cookieNonce)))) {
      throw new LoginNonceUnauthorizedException();
    }
  }

  /**
   * The user of the Google account: by its id, else by its verified email (linking the account to a
   * user added by email), else a new user when the email is allowed. 403 otherwise.
   */
  private async resolveUser(identity: GoogleIdentity): Promise<User> {
    if (!identity.emailVerified) {
      throw new UnverifiedEmailForbiddenException();
    }
    const profile = { name: identity.name, avatarUrl: identity.avatarUrl, lastLoginAt: new Date() };

    const linked = await this.userRepository.findByGoogleSub(identity.sub);
    if (linked) {
      return this.userRepository.update(linked.id, profile);
    }
    const byEmail = await this.userRepository.findByEmail(identity.email);
    if (byEmail) {
      if (byEmail.googleSub) {
        throw new GoogleAccountMismatchForbiddenException();
      }
      return this.userRepository.update(byEmail.id, { ...profile, googleSub: identity.sub });
    }
    if (!this.authConfig.allowedEmails.has(identity.email)) {
      throw new EmailNotAllowedForbiddenException();
    }
    const created = await this.userRepository.create({
      ...profile,
      email: identity.email,
      googleSub: identity.sub,
    });
    this.logger.log(`User ${created.id} signed up`);
    return created;
  }
}
