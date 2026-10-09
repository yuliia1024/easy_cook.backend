import { Module } from '@nestjs/common';
import { AuthModule } from '../../../modules/services/auth/auth.module';
import { EmailConfirmationModule } from '../../../modules/services/email-confirmation/email-confirmation.module';
import { MailModule } from '../../../modules/services/mail/mail.module';
import { UserProfileModule } from '../../../modules/services/user-profile/user-profile.module';
import { UserModule } from '../../../modules/services/user/user.module';
import { UserControllerService } from './user-controller.service';
import { UserController } from './user.controller';

@Module({
  imports: [AuthModule, UserModule, UserProfileModule, EmailConfirmationModule, MailModule],
  controllers: [UserController],
  providers: [UserControllerService],
})
export class UserControllerModule {}
