import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module';
import { DietaryPreferenceModule } from '../dietary-preference/dietary-preference.module';
import { PreferenceChangeService } from './preference-change.service';

@Module({
  imports: [ConversationModule, DietaryPreferenceModule],
  providers: [PreferenceChangeService],
  exports: [PreferenceChangeService],
})
export class PreferenceChangeModule {}
