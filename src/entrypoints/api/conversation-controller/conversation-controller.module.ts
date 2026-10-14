import { Module } from '@nestjs/common';
import { ChatModule } from '../../../modules/services/chat/chat.module';
import { ConversationControllerService } from './conversation-controller.service';
import { ConversationController } from './conversation.controller';

@Module({
  imports: [ChatModule],
  controllers: [ConversationController],
  providers: [ConversationControllerService],
})
export class ConversationControllerModule {}
