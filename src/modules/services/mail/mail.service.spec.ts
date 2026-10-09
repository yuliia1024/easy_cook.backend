import { OtpType } from '../../../common/constants';
import { NodemailerService } from '../../../providers/nodemailer/nodemailer.service';
import { createMock } from '../../../test/create-mock';
import { MailService } from './mail.service';

describe('MailService', () => {
  let nodemailer: jest.Mocked<NodemailerService>;
  let service: MailService;

  beforeEach(() => {
    nodemailer = createMock<NodemailerService>();
    service = new MailService(nodemailer);
  });

  it.each([
    [OtpType.EmailVerification, 'Confirm your email'],
    [OtpType.PasswordReset, 'Password reset code'],
    [OtpType.EmailChange, 'Confirm your new email'],
  ])('sends a %s code with its own subject', async (type, subject) => {
    await service.sendOtp('jane@example.com', type, '123456', 600);

    expect(nodemailer.sendTemplatedEmail).toHaveBeenCalledWith(
      'jane@example.com',
      subject,
      'otp-code',
      expect.objectContaining({ code: '123456', ttlInMinutes: 10 }),
    );
  });

  it('rounds the code lifetime up to whole minutes', async () => {
    await service.sendOtp('a@b.c', OtpType.PasswordReset, '1', 61);

    expect(nodemailer.sendTemplatedEmail.mock.calls[0][3]).toMatchObject({ ttlInMinutes: 2 });
  });

  it('sends a password changed notice', async () => {
    await service.sendPasswordChanged('jane@example.com');

    expect(nodemailer.sendTemplatedEmail).toHaveBeenCalledWith(
      'jane@example.com',
      'Your password was changed',
      'notification',
      expect.objectContaining({ title: 'Your password was changed' }),
    );
  });

  it('tells the old address which email the account moved to', async () => {
    await service.sendEmailChanged('old@example.com', 'new@example.com');

    const [to, , template, data] = nodemailer.sendTemplatedEmail.mock.calls[0];
    expect(to).toBe('old@example.com');
    expect(template).toBe('notification');
    expect((data as { message: string }).message).toContain('new@example.com');
  });
});
