import { Module } from '@nestjs/common';
import { UserProfileModule } from '../../../modules/services/user-profile/user-profile.module';
import { ProfileControllerService } from './profile-controller.service';
import { ProfileController } from './profile.controller';

@Module({
  imports: [UserProfileModule],
  controllers: [ProfileController],
  providers: [ProfileControllerService],
})
export class ProfileControllerModule {}
