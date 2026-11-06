import { Module } from '@nestjs/common';
import { ChatTraceService } from './chat-trace.service';

@Module({
  providers: [ChatTraceService],
  exports: [ChatTraceService],
})
export class ChatTraceModule {}
