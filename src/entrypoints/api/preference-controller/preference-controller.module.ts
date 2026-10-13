import { Module } from '@nestjs/common';
import { DietaryPreferenceModule } from '../../../modules/services/dietary-preference/dietary-preference.module';
import { PreferenceControllerService } from './preference-controller.service';
import { PreferenceController } from './preference.controller';

@Module({
  imports: [DietaryPreferenceModule],
  controllers: [PreferenceController],
  providers: [PreferenceControllerService],
})
export class PreferenceControllerModule {}
