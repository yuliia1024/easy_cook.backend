import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthStorageModule } from '../auth-storage/auth-storage.module';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  // Secrets differ per token type, so they are passed on each sign/verify call.
  imports: [JwtModule.register({}), AuthStorageModule],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
