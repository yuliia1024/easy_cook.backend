import { Injectable } from '@nestjs/common';
import { CookieOptions } from 'express';
import {
  CookieSameSite,
  DEFAULT_COOKIE_SAME_SITE,
  LOGIN_NONCE_COOKIE_NAME,
  LOGIN_NONCE_TTL_SECONDS,
  SECURE_COOKIE_PREFIX,
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_COOKIE_NAME,
} from '../../common/constants';
import { ConfigService } from '../config.service';

@Injectable()
export class AuthConfigService {
  constructor(private readonly configService: ConfigService) {}

  public get googleClientId(): string {
    return this.configService.get('GOOGLE_CLIENT_ID');
  }

  public get secret(): string {
    return this.configService.get('AUTH_SECRET');
  }

  /** `AUTH_ALLOWED_EMAILS` in lower case. */
  public get allowedEmails(): ReadonlySet<string> {
    const value = this.configService.get('AUTH_ALLOWED_EMAILS') ?? '';
    return new Set(
      value
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  /** Secure unless `AUTH_COOKIE_SECURE=false` (allowed with `ENV=local` only). */
  public get cookieSecure(): boolean {
    return this.configService.get('AUTH_COOKIE_SECURE') !== 'false';
  }

  /** `__Host-ec_session` when Secure: the browser then refuses it without HTTPS, a Domain or Path=/. */
  public get cookieName(): string {
    return this.withPrefix(SESSION_COOKIE_NAME);
  }

  public get loginNonceCookieName(): string {
    return this.withPrefix(LOGIN_NONCE_COOKIE_NAME);
  }

  public get sameSite(): CookieSameSite {
    return this.configService.get('AUTH_COOKIE_SAME_SITE') || DEFAULT_COOKIE_SAME_SITE;
  }

  /**
   * httpOnly (no script reads it), Secure, SameSite, host-only (no Domain), Path=/; for the absolute
   * session lifetime, or the life of a login nonce.
   */
  public cookieOptions(lifetimeSeconds = SESSION_ABSOLUTE_TTL_SECONDS): CookieOptions {
    return {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.sameSite,
      path: '/',
      maxAge: lifetimeSeconds * 1000,
    };
  }

  public loginNonceCookieOptions(): CookieOptions {
    return this.cookieOptions(LOGIN_NONCE_TTL_SECONDS);
  }

  /** The cookie attributes without a lifetime: what `clearCookie` must match. */
  public clearCookieOptions(): CookieOptions {
    const { maxAge: _maxAge, ...options } = this.cookieOptions();
    return options;
  }

  private withPrefix(name: string): string {
    return this.cookieSecure ? `${SECURE_COOKIE_PREFIX}${name}` : name;
  }
}
