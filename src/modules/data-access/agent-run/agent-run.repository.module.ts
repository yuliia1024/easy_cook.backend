import { Module } from '@nestjs/common';
import { AgentRunRepository } from './agent-run.repository';

@Module({
  providers: [AgentRunRepository],
  exports: [AgentRunRepository],
})
export class AgentRunRepositoryModule {}
