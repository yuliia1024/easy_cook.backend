import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module';
import { ConversationSummaryModule } from '../conversation-summary/conversation-summary.module';
import { GeneralChatModule } from '../general-chat/general-chat.module';
import { IntentModule } from '../intent/intent.module';
import { MenuModule } from '../menu/menu.module';
import { ProfileContextModule } from '../profile-context/profile-context.module';
import { ChatOrchestratorService } from './chat-orchestrator.service';

@Module({
  imports: [
    ConversationModule,
    ConversationSummaryModule,
    ProfileContextModule,
    IntentModule,
    GeneralChatModule,
    MenuModule,
  ],
  providers: [ChatOrchestratorService],
  exports: [ChatOrchestratorService],
})
export class ChatOrchestratorModule {}
