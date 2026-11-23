import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { RateLimitName } from '../../../common/constants';
import { AuthConfigService } from '../../../configs/auth-config/auth-config.service';
import { AuthenticatedSession, AuthService } from '../../../modules/services/auth/auth.service';
import { RedisThrottlerStorage } from '../../../providers/redis/redis-throttler.storage';
import { rateLimitKey } from '../rate-limit/rate-limit.key';
import { AuthSessionResponseDto, LoginNonceResponseDto } from './dto/auth.response.dto';

/** Turns the sessions of `AuthService` into cookies: the tokens never appear in a response body. */
@Injectable()
export class AuthControllerService {
  constructor(
    private readonly authService: AuthService,
    private readonly authConfig: AuthConfigService,
    private readonly rateLimits: RedisThrottlerStorage,
  ) {}

  public async createLoginNonce(response: Response): Promise<LoginNonceResponseDto> {
    const nonce = await this.authService.createLoginNonce();
    response.cookie(
      this.authConfig.loginNonceCookieName,
      nonce,
      this.authConfig.loginNonceCookieOptions(),
    );
    return { nonce };
  }

  /**
   * The nonce cookie goes whatever the outcome (a nonce serves one attempt); a new session cookie
   * replaces the one the browser had. A success forgets the failed attempts of the client
   * (`rateLimitTracker`): the sign-in limit counts failures only.
   */
  public async signInWithGoogle(
    idToken: string,
    cookies: Record<string, unknown>,
    userAgent: string | undefined,
    rateLimitTracker: string,
    response: Response,
  ): Promise<AuthSessionResponseDto> {
    response.clearCookie(
      this.authConfig.loginNonceCookieName,
      this.authConfig.clearCookieOptions(),
    );
    const signedIn = await this.authService.signInWithGoogle(
      idToken,
      cookies[this.authConfig.loginNonceCookieName],
      userAgent,
      cookies[this.authConfig.cookieName],
    );
    response.cookie(this.authConfig.cookieName, signedIn.token, this.authConfig.cookieOptions());
    await this.rateLimits.forget(rateLimitKey(RateLimitName.SignIn, rateLimitTracker));
    return AuthSessionResponseDto.from(signedIn.user, signedIn.csrfToken);
  }

  public getSession(session: AuthenticatedSession): AuthSessionResponseDto {
    return AuthSessionResponseDto.from(
      session.user,
      this.authService.csrfTokenFor(session.tokenHash),
    );
  }

  public async signOut(cookies: Record<string, unknown>, response: Response): Promise<void> {
    await this.authService.signOut(cookies[this.authConfig.cookieName]);
    this.clearSessionCookie(response);
  }

  public async signOutEverywhere(session: AuthenticatedSession, response: Response): Promise<void> {
    await this.authService.signOutEverywhere(session.user.id);
    this.clearSessionCookie(response);
  }

  private clearSessionCookie(response: Response): void {
    response.clearCookie(this.authConfig.cookieName, this.authConfig.clearCookieOptions());
  }
}
