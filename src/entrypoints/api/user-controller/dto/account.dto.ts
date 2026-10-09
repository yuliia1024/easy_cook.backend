import { IsString, MaxLength } from 'class-validator';
import { IsOtpCode, IsUserEmail, IsUserPassword } from '../../dto/validators';

export class ChangePasswordDto {
  @IsString()
  @MaxLength(256)
  currentPassword: string;

  /** @example NewSecret123 */
  @IsUserPassword()
  newPassword: string;
}

export class ChangeEmailDto {
  /** A confirmation code is sent to this address. @example jane.new@example.com */
  @IsUserEmail()
  newEmail: string;

  /** Current password, re-checked for this sensitive change. */
  @IsString()
  @MaxLength(256)
  password: string;
}

export class ConfirmEmailChangeDto {
  /** The code sent to the new email. @example 123456 */
  @IsOtpCode()
  code: string;
}
