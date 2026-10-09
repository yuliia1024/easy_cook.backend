import { IsJWT, IsString, MaxLength } from 'class-validator';
import { IsOtpCode, IsUserEmail, IsUserPassword } from '../../dto/validators';

export class SignUpDto {
  /** @example jane@example.com */
  @IsUserEmail()
  email: string;

  /** 8-64 characters, at least one letter and one digit. @example Secret123 */
  @IsUserPassword()
  password: string;
}

export class SignInDto {
  /** @example jane@example.com */
  @IsUserEmail()
  email: string;

  // Not validated against the password policy: a sign-in must never reveal it.
  @IsString()
  @MaxLength(256)
  password: string;
}

export class EmailDto {
  /** @example jane@example.com */
  @IsUserEmail()
  email: string;
}

export class VerifyEmailDto {
  /** @example jane@example.com */
  @IsUserEmail()
  email: string;

  /** The code from the email. @example 123456 */
  @IsOtpCode()
  code: string;
}

export class ResetPasswordDto {
  /** @example jane@example.com */
  @IsUserEmail()
  email: string;

  /** The code from the email. @example 123456 */
  @IsOtpCode()
  code: string;

  /** @example NewSecret123 */
  @IsUserPassword()
  password: string;
}

export class RefreshTokenDto {
  @IsJWT()
  refreshToken: string;
}
