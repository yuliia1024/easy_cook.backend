import { Module } from '@nestjs/common';
import { AuthStorageService } from './auth-storage.service';

@Module({
  providers: [AuthStorageService],
  exports: [AuthStorageService],
})
export class AuthStorageModule {}
