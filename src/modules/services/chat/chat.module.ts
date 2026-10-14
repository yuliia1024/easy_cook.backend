import { Module } from '@nestjs/common';
import { ConversationRepositoryModule } from '../../data-access/conversation/conversation.repository.module';
import { AssistantModule } from '../assistant/assistant.module';
import { MenuModule } from '../menu/menu.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { ChatService } from './chat.service';

@Module({
  imports: [ConversationRepositoryModule, UserProfileModule, MenuModule, AssistantModule],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
