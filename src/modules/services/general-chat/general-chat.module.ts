import { Module } from '@nestjs/common';
import { ChatToolsModule } from '../chat-tools/chat-tools.module';
import { GeneralChatService } from './general-chat.service';

@Module({
  imports: [ChatToolsModule],
  providers: [GeneralChatService],
  exports: [GeneralChatService],
})
export class GeneralChatModule {}
