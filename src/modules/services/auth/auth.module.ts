import { Module } from '@nestjs/common';
import { GoogleIdentityModule } from '../../../providers/google/google-identity.module';
import { AuthSessionRepositoryModule } from '../../data-access/auth-session/auth-session.repository.module';
import { UserRepositoryModule } from '../../data-access/user/user.repository.module';
import { AuthService } from './auth.service';

@Module({
  imports: [GoogleIdentityModule, UserRepositoryModule, AuthSessionRepositoryModule],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
