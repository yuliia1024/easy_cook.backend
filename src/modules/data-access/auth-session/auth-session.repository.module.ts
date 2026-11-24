import { Module } from '@nestjs/common';
import { AuthSessionRepository } from './auth-session.repository';

@Module({
  providers: [AuthSessionRepository],
  exports: [AuthSessionRepository],
})
export class AuthSessionRepositoryModule {}
