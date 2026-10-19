import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module';
import { GeneralChatModule } from '../general-chat/general-chat.module';
import { IntentModule } from '../intent/intent.module';
import { MenuModule } from '../menu/menu.module';
import { ChatOrchestratorService } from './chat-orchestrator.service';

@Module({
  imports: [ConversationModule, IntentModule, GeneralChatModule, MenuModule],
  providers: [ChatOrchestratorService],
  exports: [ChatOrchestratorService],
})
export class ChatOrchestratorModule {}
