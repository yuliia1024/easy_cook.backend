import { Module } from '@nestjs/common';
import { NodemailerModule } from '../../../providers/nodemailer/nodemailer.module';
import { MailService } from './mail.service';

@Module({
  imports: [NodemailerModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
