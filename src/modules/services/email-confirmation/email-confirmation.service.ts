import { Injectable } from '@nestjs/common';
import { OtpType } from '../../../common/constants';
import { MailService } from '../mail/mail.service';
import { OtpService } from '../otp/otp.service';

/** Issues a one-time code and emails it; checks a code the user typed back. */
@Injectable()
export class EmailConfirmationService {
  constructor(
    private readonly otpService: OtpService,
    private readonly mailService: MailService,
  ) {}

  public async send(type: OtpType, userId: string, email: string, payload?: string): Promise<void> {
    const code = await this.otpService.issue(type, userId, payload);

    try {
      await this.mailService.sendOtp(email, type, code, this.otpService.ttlInSec);
    } catch (error) {
      // The user never got this code: drop it together with the cooldown so they can retry now.
      await this.otpService.revoke(type, userId);
      throw error;
    }
  }

  /** @returns the payload stored with the code, if any */
  public async confirm(type: OtpType, userId: string, code: string): Promise<string | null> {
    return this.otpService.verify(type, userId, code);
  }
}
