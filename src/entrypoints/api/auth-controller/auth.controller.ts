import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { RateLimitName } from '../../../common/constants';
import { AuthenticatedSession } from '../../../modules/services/auth/auth.service';
import { AuthenticatedRequest, CurrentSession } from '../auth/current-session.decorator';
import { Public } from '../auth/public.decorator';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { rateLimitTracker } from '../rate-limit/rate-limit.key';
import { AuthControllerService } from './auth-controller.service';
import { GoogleSignInDto } from './dto/google-sign-in.dto';
import { AuthSessionResponseDto, LoginNonceResponseDto } from './dto/auth.response.dto';

/**
 * Google sign-in into an httpOnly session cookie. The web app: `GET nonce` -> Google Identity
 * Services with that nonce -> `POST google` with the ID token -> the cookie, and the CSRF token to
 * send in `X-CSRF-Token` on every unsafe request.
 */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authControllerService: AuthControllerService) {}

  /** A one-time nonce for the next sign-in (10 minutes), also set as an httpOnly cookie. */
  @Public()
  @Get('nonce')
  async createNonce(
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginNonceResponseDto> {
    return this.authControllerService.createLoginNonce(response);
  }

  /**
   * 401 for an invalid Google token or a missing / used / foreign nonce; 403 for an unverified email,
   * an email without access or one linked to another Google account. 3 failed attempts per 15
   * minutes (`RATE_LIMITS.sign_in`, a success clears them); one more blocks the client from
   * signing in for 30 minutes.
   */
  @Public()
  @RateLimit(RateLimitName.SignIn)
  @Post('google')
  @HttpCode(HttpStatus.OK)
  async signInWithGoogle(
    @Body() dto: GoogleSignInDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponseDto> {
    return this.authControllerService.signInWithGoogle(
      dto.idToken,
      request.cookies ?? {},
      request.headers['user-agent'],
      rateLimitTracker(request),
      response,
    );
  }

  /** The signed-in user and a CSRF token; 401 when signed out. */
  @ApiCookieAuth()
  @Get('session')
  getSession(@CurrentSession() session: AuthenticatedSession): AuthSessionResponseDto {
    return this.authControllerService.getSession(session);
  }

  @ApiCookieAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authControllerService.signOut(request.cookies ?? {}, response);
  }
}
