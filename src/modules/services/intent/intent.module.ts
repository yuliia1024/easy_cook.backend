import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module';
import { IntentService } from './intent.service';

@Module({
  imports: [ConversationModule],
  providers: [IntentService],
  exports: [IntentService],
})
export class IntentModule {}
