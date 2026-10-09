import { Logger } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { OtpType } from '../../../common/constants';
import {
  EmailAlreadyVerifiedConflictException,
  EmailExistConflictException,
  EmailNotVerifiedForbiddenException,
  InvalidCredentialsUnauthorizedException,
  WrongOtpBadRequestException,
} from '../../../common/exceptions';
import { AuthService } from '../../../modules/services/auth/auth.service';
import { EmailConfirmationService } from '../../../modules/services/email-confirmation/email-confirmation.service';
import { MailService } from '../../../modules/services/mail/mail.service';
import { PasswordService } from '../../../modules/services/password/password.service';
import { UserService } from '../../../modules/services/user/user.service';
import { createMock } from '../../../test/create-mock';
import { buildProfile, buildUser, SESSION_ID, USER_ID } from '../../../test/fixtures';
import { AuthControllerService } from './auth-controller.service';

describe('AuthControllerService', () => {
  let dataSource: jest.Mocked<DataSource>;
  let manager: jest.Mocked<EntityManager>;
  let userService: jest.Mocked<UserService>;
  let passwordService: jest.Mocked<PasswordService>;
  let authService: jest.Mocked<AuthService>;
  let emailConfirmation: jest.Mocked<EmailConfirmationService>;
  let mailService: jest.Mocked<MailService>;
  let service: AuthControllerService;

  const tokens = { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 };
  const email = 'jane@example.com';

  beforeEach(() => {
    manager = createMock<EntityManager>();
    dataSource = createMock<DataSource>();
    dataSource.transaction.mockImplementation((async (work: (m: EntityManager) => unknown) =>
      work(manager)) as never);
    userService = createMock<UserService>();
    passwordService = createMock<PasswordService>();
    authService = createMock<AuthService>();
    authService.issueTokens.mockResolvedValue(tokens);
    emailConfirmation = createMock<EmailConfirmationService>();
    mailService = createMock<MailService>();

    service = new AuthControllerService(
      dataSource,
      userService,
      passwordService,
      authService,
      emailConfirmation,
      mailService,
    );
  });

  describe('signUp', () => {
    it('creates the user and emails a verification code in one transaction', async () => {
      userService.isEmailTaken.mockResolvedValue(false);
      userService.create.mockResolvedValue(buildUser({ isEmailVerified: false }));

      await expect(service.signUp({ email, password: 'Secret123' })).resolves.toEqual({ email });
      expect(userService.create).toHaveBeenCalledWith(email, 'Secret123', manager);
      expect(emailConfirmation.send).toHaveBeenCalledWith(
        OtpType.EmailVerification,
        USER_ID,
        email,
      );
    });

    it('refuses a registered email', async () => {
      userService.isEmailTaken.mockResolvedValue(true);

      await expect(service.signUp({ email, password: 'Secret123' })).rejects.toBeInstanceOf(
        EmailExistConflictException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('turns a unique violation from a concurrent sign-up into a conflict', async () => {
      userService.isEmailTaken.mockResolvedValue(false);
      const error = new QueryFailedError('INSERT', [], new Error('duplicate key'));
      (error as unknown as { code: string }).code = '23505';
      userService.create.mockRejectedValue(error);

      await expect(service.signUp({ email, password: 'Secret123' })).rejects.toBeInstanceOf(
        EmailExistConflictException,
      );
    });

    it('rethrows other failures, rolling the user back when the email cannot be sent', async () => {
      userService.isEmailTaken.mockResolvedValue(false);
      userService.create.mockResolvedValue(buildUser());
      emailConfirmation.send.mockRejectedValue(new Error('SMTP down'));

      await expect(service.signUp({ email, password: 'Secret123' })).rejects.toThrow('SMTP down');
    });
  });

  describe('verifyEmail', () => {
    it('confirms the code, verifies the email and signs the user in', async () => {
      userService.findByEmail.mockResolvedValue(buildUser({ isEmailVerified: false }));
      userService.getById.mockResolvedValue(buildUser({ profile: buildProfile() }));

      const result = await service.verifyEmail({ email, code: '123456' });

      expect(emailConfirmation.confirm).toHaveBeenCalledWith(
        OtpType.EmailVerification,
        USER_ID,
        '123456',
      );
      expect(userService.markEmailVerified).toHaveBeenCalledWith(USER_ID);
      expect(userService.markLoggedIn).toHaveBeenCalledWith(USER_ID);
      expect(result).toMatchObject({ ...tokens, user: { id: USER_ID, isProfileCompleted: true } });
    });

    it('does not reveal unknown emails', async () => {
      userService.findByEmail.mockResolvedValue(null);

      await expect(service.verifyEmail({ email, code: '123456' })).rejects.toBeInstanceOf(
        WrongOtpBadRequestException,
      );
    });

    it('refuses an already verified email', async () => {
      userService.findByEmail.mockResolvedValue(buildUser({ isEmailVerified: true }));

      await expect(service.verifyEmail({ email, code: '123456' })).rejects.toBeInstanceOf(
        EmailAlreadyVerifiedConflictException,
      );
      expect(emailConfirmation.confirm).not.toHaveBeenCalled();
    });

    it('does not verify on a wrong code', async () => {
      userService.findByEmail.mockResolvedValue(buildUser({ isEmailVerified: false }));
      emailConfirmation.confirm.mockRejectedValue(new WrongOtpBadRequestException());

      await expect(service.verifyEmail({ email, code: '000000' })).rejects.toBeInstanceOf(
        WrongOtpBadRequestException,
      );
      expect(userService.markEmailVerified).not.toHaveBeenCalled();
      expect(authService.issueTokens).not.toHaveBeenCalled();
    });
  });

  describe('resendVerification', () => {
    it('sends a new code to an unverified user', async () => {
      userService.findByEmail.mockResolvedValue(buildUser({ isEmailVerified: false }));

      await service.resendVerification({ email });

      expect(emailConfirmation.send).toHaveBeenCalledWith(
        OtpType.EmailVerification,
        USER_ID,
        email,
      );
    });

    it.each([
      ['an unknown email', null],
      ['a verified email', buildUser({ isEmailVerified: true })],
    ])('silently ignores %s', async (_case, user) => {
      userService.findByEmail.mockResolvedValue(user);

      await expect(service.resendVerification({ email })).resolves.toBeUndefined();
      expect(emailConfirmation.send).not.toHaveBeenCalled();
    });
  });

  describe('signIn', () => {
    it('issues tokens for valid credentials of a verified user', async () => {
      userService.findByEmailWithPassword.mockResolvedValue(buildUser());
      passwordService.compare.mockResolvedValue(true);
      userService.getById.mockResolvedValue(buildUser());

      const result = await service.signIn({ email, password: 'Secret123' });

      expect(passwordService.compare).toHaveBeenCalledWith('Secret123', 'hashed-password');
      expect(result).toMatchObject({ ...tokens, user: { email, isProfileCompleted: false } });
      expect(result.user).not.toHaveProperty('password');
    });

    it('rejects a wrong password', async () => {
      userService.findByEmailWithPassword.mockResolvedValue(buildUser());
      passwordService.compare.mockResolvedValue(false);

      await expect(service.signIn({ email, password: 'nope' })).rejects.toBeInstanceOf(
        InvalidCredentialsUnauthorizedException,
      );
      expect(authService.issueTokens).not.toHaveBeenCalled();
    });

    it('answers an unknown email exactly like a wrong password', async () => {
      userService.findByEmailWithPassword.mockResolvedValue(null);
      passwordService.compare.mockResolvedValue(false);

      await expect(service.signIn({ email, password: 'nope' })).rejects.toBeInstanceOf(
        InvalidCredentialsUnauthorizedException,
      );
    });

    it('refuses an unverified email only after the password matched', async () => {
      userService.findByEmailWithPassword.mockResolvedValue(buildUser({ isEmailVerified: false }));
      passwordService.compare.mockResolvedValue(true);

      await expect(service.signIn({ email, password: 'Secret123' })).rejects.toBeInstanceOf(
        EmailNotVerifiedForbiddenException,
      );
      expect(authService.issueTokens).not.toHaveBeenCalled();
    });
  });

  it('refresh rotates the token pair', async () => {
    authService.refresh.mockResolvedValue(tokens);

    await expect(service.refresh({ refreshToken: 'r' })).resolves.toBe(tokens);
    expect(authService.refresh).toHaveBeenCalledWith('r');
  });

  it('signOut revokes the current session', async () => {
    const user = { userId: USER_ID, sessionId: SESSION_ID };

    await service.signOut(user);

    expect(authService.revokeSession).toHaveBeenCalledWith(user);
  });

  it('signOutAll revokes every session', async () => {
    await service.signOutAll({ userId: USER_ID, sessionId: SESSION_ID });

    expect(authService.revokeAllSessions).toHaveBeenCalledWith(USER_ID);
  });

  describe('forgotPassword', () => {
    it('emails a reset code', async () => {
      userService.findByEmail.mockResolvedValue(buildUser());

      await service.forgotPassword({ email });

      expect(emailConfirmation.send).toHaveBeenCalledWith(OtpType.PasswordReset, USER_ID, email);
    });

    it('silently ignores an unknown email', async () => {
      userService.findByEmail.mockResolvedValue(null);

      await expect(service.forgotPassword({ email })).resolves.toBeUndefined();
      expect(emailConfirmation.send).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const dto = { email, code: '123456', password: 'NewSecret1' };

    beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation());

    it('sets the password, signs out everywhere and notifies the user', async () => {
      userService.findByEmail.mockResolvedValue(buildUser());

      await service.resetPassword(dto);

      expect(emailConfirmation.confirm).toHaveBeenCalledWith(
        OtpType.PasswordReset,
        USER_ID,
        '123456',
      );
      expect(userService.setPassword).toHaveBeenCalledWith(USER_ID, 'NewSecret1');
      expect(userService.markEmailVerified).not.toHaveBeenCalled();
      expect(authService.revokeAllSessions).toHaveBeenCalledWith(USER_ID);
      expect(mailService.sendPasswordChanged).toHaveBeenCalledWith(email);
    });

    it('verifies a never verified email, since the code proved ownership', async () => {
      userService.findByEmail.mockResolvedValue(buildUser({ isEmailVerified: false }));

      await service.resetPassword(dto);

      expect(userService.markEmailVerified).toHaveBeenCalledWith(USER_ID);
    });

    it('does not reveal unknown emails', async () => {
      userService.findByEmail.mockResolvedValue(null);

      await expect(service.resetPassword(dto)).rejects.toBeInstanceOf(WrongOtpBadRequestException);
    });

    it('keeps the old password on a wrong code', async () => {
      userService.findByEmail.mockResolvedValue(buildUser());
      emailConfirmation.confirm.mockRejectedValue(new WrongOtpBadRequestException());

      await expect(service.resetPassword(dto)).rejects.toBeInstanceOf(WrongOtpBadRequestException);
      expect(userService.setPassword).not.toHaveBeenCalled();
      expect(authService.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('still succeeds when the notice cannot be sent, and logs it', async () => {
      userService.findByEmail.mockResolvedValue(buildUser());
      mailService.sendPasswordChanged.mockRejectedValue(new Error('SMTP down'));

      await expect(service.resetPassword(dto)).resolves.toBeUndefined();
      expect(Logger.prototype.error).toHaveBeenCalled();
    });
  });
});
