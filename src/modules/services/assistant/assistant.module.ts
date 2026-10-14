import { Module } from '@nestjs/common';
import { Assistant } from './assistant';
import { StubAssistant } from './stub-assistant';

/** Binds the `Assistant` port; the LLM implementation replaces `StubAssistant` here. */
@Module({
  providers: [{ provide: Assistant, useClass: StubAssistant }],
  exports: [Assistant],
})
export class AssistantModule {}
