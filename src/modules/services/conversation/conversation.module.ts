import { Module } from '@nestjs/common';
import { ConversationRepositoryModule } from '../../data-access/conversation/conversation.repository.module';
import { MenuModule } from '../menu/menu.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { ConversationService } from './conversation.service';

@Module({
  imports: [ConversationRepositoryModule, UserProfileModule, MenuModule],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
