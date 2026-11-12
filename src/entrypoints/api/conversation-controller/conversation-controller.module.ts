import { Module } from '@nestjs/common';
import { ChatOrchestratorModule } from '../../../modules/services/chat-orchestrator/chat-orchestrator.module';
import { ConversationModule } from '../../../modules/services/conversation/conversation.module';
import { PreferenceChangeModule } from '../../../modules/services/preference-change/preference-change.module';
import { ConversationControllerService } from './conversation-controller.service';
import { ConversationController } from './conversation.controller';

@Module({
  imports: [ConversationModule, ChatOrchestratorModule, PreferenceChangeModule],
  controllers: [ConversationController],
  providers: [ConversationControllerService],
})
export class ConversationControllerModule {}
