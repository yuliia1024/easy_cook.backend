import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../../common/decorators';
import { AuthUser } from '../../../common/types';
import { JwtAuthGuard } from '../../../modules/services/auth/jwt-auth.guard';
import { AuthControllerService } from './auth-controller.service';
import {
  EmailDto,
  RefreshTokenDto,
  ResetPasswordDto,
  SignInDto,
  SignUpDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { AuthResponseDto, SignUpResponseDto, TokensResponseDto } from './dto/auth.response.dto';

@ApiTags('Auth')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(private readonly authControllerService: AuthControllerService) {}

  /** Registers an account and emails a confirmation code. */
  @Post('sign-up')
  async signUp(@Body() dto: SignUpDto): Promise<SignUpResponseDto> {
    return this.authControllerService.signUp(dto);
  }

  /** Confirms the email with the code from the sign-up email and signs the user in. */
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<AuthResponseDto> {
    return this.authControllerService.verifyEmail(dto);
  }

  /** Sends a new email confirmation code. */
  @Post('verify-email/resend')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resendVerification(@Body() dto: EmailDto): Promise<void> {
    return this.authControllerService.resendVerification(dto);
  }

  /** Email + password. Answers 403 while the email is not confirmed. */
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  async signIn(@Body() dto: SignInDto): Promise<AuthResponseDto> {
    return this.authControllerService.signIn(dto);
  }

  /** Exchanges a refresh token for a new token pair. A refresh token works once. */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto): Promise<TokensResponseDto> {
    return this.authControllerService.refresh(dto);
  }

  /** Ends the current session. */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(@CurrentUser() user: AuthUser): Promise<void> {
    return this.authControllerService.signOut(user);
  }

  /** Ends every session of the user on every device. */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('sign-out-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOutAll(@CurrentUser() user: AuthUser): Promise<void> {
    return this.authControllerService.signOutAll(user);
  }

  /** Emails a password reset code. */
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(@Body() dto: EmailDto): Promise<void> {
    return this.authControllerService.forgotPassword(dto);
  }

  /** Sets a new password using the emailed code and signs out every session. */
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.authControllerService.resetPassword(dto);
  }
}
