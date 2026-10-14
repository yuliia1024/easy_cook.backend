import { Module } from '@nestjs/common';
import { ConversationRepository } from './conversation.repository';

@Module({
  providers: [ConversationRepository],
  exports: [ConversationRepository],
})
export class ConversationRepositoryModule {}
