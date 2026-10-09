import { Module } from '@nestjs/common';
import { UserRepositoryModule } from '../../data-access/user/user.repository.module';
import { PasswordModule } from '../password/password.module';
import { UserService } from './user.service';

@Module({
  imports: [UserRepositoryModule, PasswordModule],
  providers: [UserService],
  exports: [UserService, PasswordModule],
})
export class UserModule {}
