import { Module } from '@nestjs/common';
import { DietaryPreferenceRepository } from './dietary-preference.repository';

@Module({
  providers: [DietaryPreferenceRepository],
  exports: [DietaryPreferenceRepository],
})
export class DietaryPreferenceRepositoryModule {}
