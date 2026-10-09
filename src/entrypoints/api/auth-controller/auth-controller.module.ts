import { Module } from '@nestjs/common';
import { AuthModule } from '../../../modules/services/auth/auth.module';
import { EmailConfirmationModule } from '../../../modules/services/email-confirmation/email-confirmation.module';
import { MailModule } from '../../../modules/services/mail/mail.module';
import { UserModule } from '../../../modules/services/user/user.module';
import { AuthControllerService } from './auth-controller.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [AuthModule, UserModule, EmailConfirmationModule, MailModule],
  controllers: [AuthController],
  providers: [AuthControllerService],
})
export class AuthControllerModule {}
