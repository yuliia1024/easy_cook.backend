import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module';
import { GeneralChatService } from './general-chat.service';

@Module({
  imports: [ConversationModule],
  providers: [GeneralChatService],
  exports: [GeneralChatService],
})
export class GeneralChatModule {}
