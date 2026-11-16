import { Module } from '@nestjs/common';
import { AgentRunRepositoryModule } from '../../data-access/agent-run/agent-run.repository.module';
import { AgentRunService } from './agent-run.service';

@Module({
  imports: [AgentRunRepositoryModule],
  providers: [AgentRunService],
  exports: [AgentRunService],
})
export class AgentRunModule {}
