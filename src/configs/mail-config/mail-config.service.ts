import { Injectable } from '@nestjs/common';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { ConfigService } from '../config.service';

@Injectable()
export class MailConfigService {
  constructor(private readonly configService: ConfigService) {}

  public smtp(): SMTPTransport.Options {
    const user = this.configService.get('SMTP_USER');

    return {
      host: this.configService.get('SMTP_HOST'),
      port: this.configService.getNumber('SMTP_PORT'),
      secure: this.configService.getBoolean('SMTP_SECURE'),
      ...(user && { auth: { user, pass: this.configService.get('SMTP_PASSWORD') } }),
    };
  }

  public get fromAddress(): string {
    return this.configService.get('EMAIL_FROM_ADDRESS');
  }
}
