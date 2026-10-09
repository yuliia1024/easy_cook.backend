import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { OtpModule } from '../otp/otp.module';
import { EmailConfirmationService } from './email-confirmation.service';

@Module({
  imports: [OtpModule, MailModule],
  providers: [EmailConfirmationService],
  exports: [EmailConfirmationService],
})
export class EmailConfirmationModule {}
