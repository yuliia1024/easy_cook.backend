import { Module } from '@nestjs/common';
import { DietaryPreferenceRepositoryModule } from '../../data-access/dietary-preference/dietary-preference.repository.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { DietaryPreferenceService } from './dietary-preference.service';

@Module({
  imports: [DietaryPreferenceRepositoryModule, UserProfileModule],
  providers: [DietaryPreferenceService],
  exports: [DietaryPreferenceService],
})
export class DietaryPreferenceModule {}
