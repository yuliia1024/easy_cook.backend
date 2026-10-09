import { Logger } from '@nestjs/common';
import { Diet, Gender, OtpType } from '../../../common/constants';
import {
  EmailExistConflictException,
  SameEmailBadRequestException,
  SamePasswordBadRequestException,
  WrongCurrentPasswordBadRequestException,
  WrongOtpBadRequestException,
} from '../../../common/exceptions';
import { AuthService } from '../../../modules/services/auth/auth.service';
import { EmailConfirmationService } from '../../../modules/services/email-confirmation/email-confirmation.service';
import { MailService } from '../../../modules/services/mail/mail.service';
import { UserProfileService } from '../../../modules/services/user-profile/user-profile.service';
import { UserService } from '../../../modules/services/user/user.service';
import { createMock } from '../../../test/create-mock';
import { buildProfile, buildUser, SESSION_ID, USER_ID } from '../../../test/fixtures';
import { UserControllerService } from './user-controller.service';

describe('UserControllerService', () => {
  let userService: jest.Mocked<UserService>;
  let profileService: jest.Mocked<UserProfileService>;
  let authService: jest.Mocked<AuthService>;
  let emailConfirmation: jest.Mocked<EmailConfirmationService>;
  let mailService: jest.Mocked<MailService>;
  let service: UserControllerService;
  const authUser = { userId: USER_ID, sessionId: SESSION_ID };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    userService = createMock<UserService>();
    userService.getById.mockResolvedValue(buildUser());
    profileService = createMock<UserProfileService>();
    authService = createMock<AuthService>();
    emailConfirmation = createMock<EmailConfirmationService>();
    mailService = createMock<MailService>();
    service = new UserControllerService(
      userService,
      profileService,
      authService,
      emailConfirmation,
      mailService,
    );
  });

  it('getMe maps the user to the response shape', async () => {
    userService.getById.mockResolvedValue(buildUser({ profile: buildProfile() }));

    await expect(service.getMe(USER_ID)).resolves.toMatchObject({
      id: USER_ID,
      isProfileCompleted: true,
      profile: { firstName: 'Jane', gender: Gender.Female, diet: Diet.Vegan },
    });
  });

  it('lists every gender and diet as profile options', () => {
    expect(service.getProfileOptions()).toEqual({
      genders: Object.values(Gender),
      diets: Object.values(Diet),
    });
  });

  it('saveProfile stores the questionnaire and returns the user', async () => {
    const dto = { firstName: 'Jane', gender: Gender.Female, diet: Diet.Vegan };

    await expect(service.saveProfile(USER_ID, dto)).resolves.toMatchObject({ id: USER_ID });
    expect(profileService.save).toHaveBeenCalledWith(USER_ID, dto);
  });

  it('updateProfile changes the given fields and returns the user', async () => {
    await service.updateProfile(USER_ID, { diet: Diet.Keto });

    expect(profileService.update).toHaveBeenCalledWith(USER_ID, { diet: Diet.Keto });
    expect(userService.getById).toHaveBeenCalledWith(USER_ID);
  });

  describe('changePassword', () => {
    const dto = { currentPassword: 'Secret123', newPassword: 'NewSecret1' };

    it('sets the password, keeps the current session and notifies', async () => {
      userService.isPasswordValid.mockResolvedValue(true);

      await service.changePassword(authUser, dto);

      expect(userService.isPasswordValid).toHaveBeenCalledWith(USER_ID, 'Secret123');
      expect(userService.setPassword).toHaveBeenCalledWith(USER_ID, 'NewSecret1');
      expect(authService.revokeAllSessions).toHaveBeenCalledWith(USER_ID, SESSION_ID);
      expect(mailService.sendPasswordChanged).toHaveBeenCalledWith('jane@example.com');
    });

    it('requires the current password', async () => {
      userService.isPasswordValid.mockResolvedValue(false);

      await expect(service.changePassword(authUser, dto)).rejects.toBeInstanceOf(
        WrongCurrentPasswordBadRequestException,
      );
      expect(userService.setPassword).not.toHaveBeenCalled();
    });

    it('refuses the same password', async () => {
      userService.isPasswordValid.mockResolvedValue(true);

      await expect(
        service.changePassword(authUser, {
          currentPassword: 'Secret123',
          newPassword: 'Secret123',
        }),
      ).rejects.toBeInstanceOf(SamePasswordBadRequestException);
    });

    it('does not fail when the notice cannot be sent', async () => {
      userService.isPasswordValid.mockResolvedValue(true);
      mailService.sendPasswordChanged.mockRejectedValue(new Error('SMTP down'));

      await expect(service.changePassword(authUser, dto)).resolves.toBeUndefined();
      expect(Logger.prototype.error).toHaveBeenCalled();
    });
  });

  describe('requestEmailChange', () => {
    const dto = { newEmail: 'new@example.com', password: 'Secret123' };

    it('sends a code to the new address, carrying it as payload', async () => {
      userService.isPasswordValid.mockResolvedValue(true);
      userService.isEmailTaken.mockResolvedValue(false);

      await service.requestEmailChange(USER_ID, dto);

      expect(emailConfirmation.send).toHaveBeenCalledWith(
        OtpType.EmailChange,
        USER_ID,
        'new@example.com',
        'new@example.com',
      );
    });

    it('requires the password', async () => {
      userService.isPasswordValid.mockResolvedValue(false);

      await expect(service.requestEmailChange(USER_ID, dto)).rejects.toBeInstanceOf(
        WrongCurrentPasswordBadRequestException,
      );
      expect(emailConfirmation.send).not.toHaveBeenCalled();
    });

    it('refuses the current email', async () => {
      userService.isPasswordValid.mockResolvedValue(true);

      await expect(
        service.requestEmailChange(USER_ID, { ...dto, newEmail: 'jane@example.com' }),
      ).rejects.toBeInstanceOf(SameEmailBadRequestException);
    });

    it('refuses an email used by another account', async () => {
      userService.isPasswordValid.mockResolvedValue(true);
      userService.isEmailTaken.mockResolvedValue(true);

      await expect(service.requestEmailChange(USER_ID, dto)).rejects.toBeInstanceOf(
        EmailExistConflictException,
      );
    });
  });

  describe('confirmEmailChange', () => {
    it('switches to the confirmed email and notifies the old one', async () => {
      emailConfirmation.confirm.mockResolvedValue('new@example.com');
      userService.isEmailTaken.mockResolvedValue(false);

      await service.confirmEmailChange(USER_ID, { code: '123456' });

      expect(emailConfirmation.confirm).toHaveBeenCalledWith(
        OtpType.EmailChange,
        USER_ID,
        '123456',
      );
      expect(userService.changeEmail).toHaveBeenCalledWith(USER_ID, 'new@example.com');
      expect(mailService.sendEmailChanged).toHaveBeenCalledWith(
        'jane@example.com',
        'new@example.com',
      );
    });

    it('rejects a code without the new email', async () => {
      emailConfirmation.confirm.mockResolvedValue(null);

      await expect(service.confirmEmailChange(USER_ID, { code: '123456' })).rejects.toBeInstanceOf(
        WrongOtpBadRequestException,
      );
    });

    it('refuses when the address was registered in the meantime', async () => {
      emailConfirmation.confirm.mockResolvedValue('new@example.com');
      userService.isEmailTaken.mockResolvedValue(true);

      await expect(service.confirmEmailChange(USER_ID, { code: '123456' })).rejects.toBeInstanceOf(
        EmailExistConflictException,
      );
      expect(userService.changeEmail).not.toHaveBeenCalled();
    });
  });
});
