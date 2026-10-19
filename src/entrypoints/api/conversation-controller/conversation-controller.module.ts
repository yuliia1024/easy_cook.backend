import { Module } from '@nestjs/common';
import { ChatOrchestratorModule } from '../../../modules/services/chat-orchestrator/chat-orchestrator.module';
import { ConversationModule } from '../../../modules/services/conversation/conversation.module';
import { ConversationControllerService } from './conversation-controller.service';
import { ConversationController } from './conversation.controller';

@Module({
  imports: [ConversationModule, ChatOrchestratorModule],
  controllers: [ConversationController],
  providers: [ConversationControllerService],
})
export class ConversationControllerModule {}
