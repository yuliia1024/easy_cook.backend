import { Injectable } from '@nestjs/common';
import { OtpType } from '../../../common/constants';
import { NodemailerService } from '../../../providers/nodemailer/nodemailer.service';

const OTP_EMAIL_TEXTS: Record<OtpType, { subject: string; title: string; message: string }> = {
  [OtpType.EmailVerification]: {
    subject: 'Confirm your email',
    title: 'Welcome to Easy Cook!',
    message: 'Enter this code in the app to confirm your email address.',
  },
  [OtpType.PasswordReset]: {
    subject: 'Password reset code',
    title: 'Reset your password',
    message: 'Enter this code in the app to set a new password.',
  },
  [OtpType.EmailChange]: {
    subject: 'Confirm your new email',
    title: 'Confirm your new email',
    message: 'Enter this code in the app to start using this email address for your account.',
  },
};

@Injectable()
export class MailService {
  constructor(private readonly nodemailerService: NodemailerService) {}

  public async sendOtp(to: string, type: OtpType, code: string, ttlInSec: number): Promise<void> {
    const { subject, title, message } = OTP_EMAIL_TEXTS[type];

    await this.nodemailerService.sendTemplatedEmail(to, subject, 'otp-code', {
      title,
      message,
      code,
      ttlInMinutes: Math.ceil(ttlInSec / 60),
    });
  }

  public async sendPasswordChanged(to: string): Promise<void> {
    await this.nodemailerService.sendTemplatedEmail(
      to,
      'Your password was changed',
      'notification',
      {
        title: 'Your password was changed',
        message:
          'The password of your Easy Cook account was just changed and all sessions were signed out.',
      },
    );
  }

  public async sendEmailChanged(to: string, newEmail: string): Promise<void> {
    await this.nodemailerService.sendTemplatedEmail(to, 'Your email was changed', 'notification', {
      title: 'Your email was changed',
      message: `Your Easy Cook account now uses ${newEmail}. This address will no longer receive emails from us.`,
    });
  }
}
