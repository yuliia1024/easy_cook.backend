import { OtpType } from '../../../common/constants';
import { createMock } from '../../../test/create-mock';
import { USER_ID } from '../../../test/fixtures';
import { MailService } from '../mail/mail.service';
import { OtpService } from '../otp/otp.service';
import { EmailConfirmationService } from './email-confirmation.service';

describe('EmailConfirmationService', () => {
  let otp: jest.Mocked<OtpService>;
  let mail: jest.Mocked<MailService>;
  let service: EmailConfirmationService;
  const type = OtpType.EmailChange;

  beforeEach(() => {
    otp = createMock<OtpService>({ ttlInSec: 600 });
    mail = createMock<MailService>();
    service = new EmailConfirmationService(otp, mail);
  });

  describe('send', () => {
    it('issues a code and emails it', async () => {
      otp.issue.mockResolvedValue('123456');

      await service.send(type, USER_ID, 'new@example.com', 'new@example.com');

      expect(otp.issue).toHaveBeenCalledWith(type, USER_ID, 'new@example.com');
      expect(mail.sendOtp).toHaveBeenCalledWith('new@example.com', type, '123456', 600);
    });

    it('revokes the code when the email cannot be sent, so a retry is possible right away', async () => {
      otp.issue.mockResolvedValue('123456');
      mail.sendOtp.mockRejectedValue(new Error('SMTP down'));

      await expect(service.send(type, USER_ID, 'a@b.c')).rejects.toThrow('SMTP down');
      expect(otp.revoke).toHaveBeenCalledWith(type, USER_ID);
    });

    it('sends nothing when the code is refused (cooldown)', async () => {
      otp.issue.mockRejectedValue(new Error('cooldown'));

      await expect(service.send(type, USER_ID, 'a@b.c')).rejects.toThrow('cooldown');
      expect(mail.sendOtp).not.toHaveBeenCalled();
      expect(otp.revoke).not.toHaveBeenCalled();
    });
  });

  it('confirm checks the code and returns its payload', async () => {
    otp.verify.mockResolvedValue('new@example.com');

    await expect(service.confirm(type, USER_ID, '123456')).resolves.toBe('new@example.com');
    expect(otp.verify).toHaveBeenCalledWith(type, USER_ID, '123456');
  });
});
