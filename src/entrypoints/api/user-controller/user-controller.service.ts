import { Injectable, Logger } from '@nestjs/common';
import { Diet, Gender, OtpType } from '../../../common/constants';
import {
  EmailExistConflictException,
  SameEmailBadRequestException,
  SamePasswordBadRequestException,
  WrongCurrentPasswordBadRequestException,
  WrongOtpBadRequestException,
} from '../../../common/exceptions';
import { AuthUser } from '../../../common/types';
import { AuthService } from '../../../modules/services/auth/auth.service';
import { EmailConfirmationService } from '../../../modules/services/email-confirmation/email-confirmation.service';
import { MailService } from '../../../modules/services/mail/mail.service';
import { UserProfileService } from '../../../modules/services/user-profile/user-profile.service';
import { UserService } from '../../../modules/services/user/user.service';
import { UserResponseDto } from '../dto/user.response.dto';
import { ChangeEmailDto, ChangePasswordDto, ConfirmEmailChangeDto } from './dto/account.dto';
import { ProfileOptionsResponseDto, SaveProfileDto, UpdateProfileDto } from './dto/profile.dto';

@Injectable()
export class UserControllerService {
  private readonly logger = new Logger(UserControllerService.name);

  constructor(
    private readonly userService: UserService,
    private readonly userProfileService: UserProfileService,
    private readonly authService: AuthService,
    private readonly emailConfirmationService: EmailConfirmationService,
    private readonly mailService: MailService,
  ) {}

  public async getMe(userId: string): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.userService.getById(userId));
  }

  public getProfileOptions(): ProfileOptionsResponseDto {
    return { genders: Object.values(Gender), diets: Object.values(Diet) };
  }

  /** Fills in (or fully replaces) the questionnaire. */
  public async saveProfile(userId: string, dto: SaveProfileDto): Promise<UserResponseDto> {
    await this.userProfileService.save(userId, dto);
    return this.getMe(userId);
  }

  public async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserResponseDto> {
    await this.userProfileService.update(userId, dto);
    return this.getMe(userId);
  }

  /** Changes the password and signs out every other session; the current one stays. */
  public async changePassword(user: AuthUser, dto: ChangePasswordDto): Promise<void> {
    if (!(await this.userService.isPasswordValid(user.userId, dto.currentPassword))) {
      throw new WrongCurrentPasswordBadRequestException();
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new SamePasswordBadRequestException();
    }

    await this.userService.setPassword(user.userId, dto.newPassword);
    await this.authService.revokeAllSessions(user.userId, user.sessionId);

    const { email } = await this.userService.getById(user.userId);
    await this.notify(() => this.mailService.sendPasswordChanged(email));
  }

  /** Sends a code to the new address; the email changes only once that code is confirmed. */
  public async requestEmailChange(userId: string, dto: ChangeEmailDto): Promise<void> {
    if (!(await this.userService.isPasswordValid(userId, dto.password))) {
      throw new WrongCurrentPasswordBadRequestException();
    }

    const user = await this.userService.getById(userId);

    if (user.email === dto.newEmail) {
      throw new SameEmailBadRequestException();
    }
    if (await this.userService.isEmailTaken(dto.newEmail)) {
      throw new EmailExistConflictException();
    }

    await this.emailConfirmationService.send(
      OtpType.EmailChange,
      userId,
      dto.newEmail,
      dto.newEmail,
    );
  }

  public async confirmEmailChange(
    userId: string,
    dto: ConfirmEmailChangeDto,
  ): Promise<UserResponseDto> {
    const newEmail = await this.emailConfirmationService.confirm(
      OtpType.EmailChange,
      userId,
      dto.code,
    );

    if (!newEmail) {
      throw new WrongOtpBadRequestException();
    }
    // Someone may have registered the address while the code was in flight.
    if (await this.userService.isEmailTaken(newEmail)) {
      throw new EmailExistConflictException();
    }

    const { email: oldEmail } = await this.userService.getById(userId);
    await this.userService.changeEmail(userId, newEmail);
    await this.notify(() => this.mailService.sendEmailChanged(oldEmail, newEmail));

    return this.getMe(userId);
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
