import { Module } from '@nestjs/common';
import { GeneralChatService } from './general-chat.service';

@Module({
  providers: [GeneralChatService],
  exports: [GeneralChatService],
})
export class GeneralChatModule {}
