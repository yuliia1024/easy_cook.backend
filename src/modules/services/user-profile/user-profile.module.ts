import { Module } from '@nestjs/common';
import { UserProfileRepositoryModule } from '../../data-access/user-profile/user-profile.repository.module';
import { UserProfileService } from './user-profile.service';

@Module({
  imports: [UserProfileRepositoryModule],
  providers: [UserProfileService],
  exports: [UserProfileService],
})
export class UserProfileModule {}
