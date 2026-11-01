import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module';
import { ConversationSummaryService } from './conversation-summary.service';

@Module({
  imports: [ConversationModule],
  providers: [ConversationSummaryService],
  exports: [ConversationSummaryService],
})
export class ConversationSummaryModule {}
