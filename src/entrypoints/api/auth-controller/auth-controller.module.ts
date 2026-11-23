import { Module } from '@nestjs/common';
import { AuthModule } from '../../../modules/services/auth/auth.module';
import { AuthControllerService } from './auth-controller.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [AuthModule],
  controllers: [AuthController],
  providers: [AuthControllerService],
})
export class AuthControllerModule {}
