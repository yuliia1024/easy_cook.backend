import { Injectable, Logger } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { OtpType } from '../../../common/constants';
import {
  EmailAlreadyVerifiedConflictException,
  EmailExistConflictException,
  EmailNotVerifiedForbiddenException,
  InvalidCredentialsUnauthorizedException,
  WrongOtpBadRequestException,
} from '../../../common/exceptions';
import { AuthUser } from '../../../common/types';
import { User } from '../../../modules/data-access/user/user.entity';
import { AuthService } from '../../../modules/services/auth/auth.service';
import { EmailConfirmationService } from '../../../modules/services/email-confirmation/email-confirmation.service';
import { MailService } from '../../../modules/services/mail/mail.service';
import { PasswordService } from '../../../modules/services/password/password.service';
import { UserService } from '../../../modules/services/user/user.service';
import { UserResponseDto } from '../dto/user.response.dto';
import {
  EmailDto,
  RefreshTokenDto,
  ResetPasswordDto,
  SignInDto,
  SignUpDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { AuthResponseDto, SignUpResponseDto, TokensResponseDto } from './dto/auth.response.dto';

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class AuthControllerService {
  private readonly logger = new Logger(AuthControllerService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly userService: UserService,
    private readonly passwordService: PasswordService,
    private readonly authService: AuthService,
    private readonly emailConfirmationService: EmailConfirmationService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Creates an unverified account and emails a confirmation code. The email is sent inside the
   * transaction: if it cannot be delivered no half-registered account is left behind.
   */
  public async signUp({ email, password }: SignUpDto): Promise<SignUpResponseDto> {
    if (await this.userService.isEmailTaken(email)) {
      throw new EmailExistConflictException();
    }

    try {
      const user = await this.dataSource.transaction(async (manager) => {
        const created = await this.userService.create(email, password, manager);
        await this.emailConfirmationService.send(
          OtpType.EmailVerification,
          created.id,
          created.email,
        );
        return created;
      });

      return { email: user.email };
    } catch (error) {
      if (error instanceof QueryFailedError && (error as any).code === PG_UNIQUE_VIOLATION) {
        throw new EmailExistConflictException();
      }
      throw error;
    }
  }

  /** Confirms the email with the code and signs the user in. */
  public async verifyEmail({ email, code }: VerifyEmailDto): Promise<AuthResponseDto> {
    const user = await this.userService.findByEmail(email);

    if (!user) {
      throw new WrongOtpBadRequestException();
    }
    if (user.isEmailVerified) {
      throw new EmailAlreadyVerifiedConflictException();
    }

    await this.emailConfirmationService.confirm(OtpType.EmailVerification, user.id, code);
    await this.userService.markEmailVerified(user.id);

    return this.signInUser(user.id);
  }

  /** Silently does nothing for unknown or already verified emails. */
  public async resendVerification({ email }: EmailDto): Promise<void> {
    const user = await this.userService.findByEmail(email);

    if (!user || user.isEmailVerified) {
      return;
    }

    await this.emailConfirmationService.send(OtpType.EmailVerification, user.id, user.email);
  }

  public async signIn({ email, password }: SignInDto): Promise<AuthResponseDto> {
    const user = await this.userService.findByEmailWithPassword(email);
    const isValid = await this.passwordService.compare(password, user?.password);

    if (!user || !isValid) {
      throw new InvalidCredentialsUnauthorizedException();
    }
    if (!user.isEmailVerified) {
      throw new EmailNotVerifiedForbiddenException();
    }

    return this.signInUser(user.id);
  }

  public async refresh({ refreshToken }: RefreshTokenDto): Promise<TokensResponseDto> {
    return this.authService.refresh(refreshToken);
  }

  public async signOut(user: AuthUser): Promise<void> {
    await this.authService.revokeSession(user);
  }

  public async signOutAll(user: AuthUser): Promise<void> {
    await this.authService.revokeAllSessions(user.userId);
  }

  /** Silently does nothing for unknown emails, so the endpoint cannot be used to probe them. */
  public async forgotPassword({ email }: EmailDto): Promise<void> {
    const user = await this.userService.findByEmail(email);

    if (!user) {
      return;
    }

    await this.emailConfirmationService.send(OtpType.PasswordReset, user.id, user.email);
  }

  /**
   * Sets a new password and signs out every session. The code proves the user owns the mailbox,
   * so an account that was never verified becomes verified as well.
   */
  public async resetPassword({ email, code, password }: ResetPasswordDto): Promise<void> {
    const user = await this.userService.findByEmail(email);

    if (!user) {
      throw new WrongOtpBadRequestException();
    }

    await this.emailConfirmationService.confirm(OtpType.PasswordReset, user.id, code);
    await this.userService.setPassword(user.id, password);

    if (!user.isEmailVerified) {
      await this.userService.markEmailVerified(user.id);
    }

    await this.authService.revokeAllSessions(user.id);
    await this.notify(() => this.mailService.sendPasswordChanged(user.email));
  }

  private async signInUser(userId: string): Promise<AuthResponseDto> {
    const tokens = await this.authService.issueTokens(userId);
    await this.userService.markLoggedIn(userId);
    const user: User = await this.userService.getById(userId);

    return { ...tokens, user: UserResponseDto.from(user) };
  }

  /** A security notice that fails to send must not fail the operation it reports on. */
  private async notify(send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.error('Failed to send notification email', (error as Error)?.stack);
    }
  }
}
