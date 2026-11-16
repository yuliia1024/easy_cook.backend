import { Injectable, Logger } from '@nestjs/common';
import { ModelCallRecord } from '../../../common/types';
import { AgentRunRepository } from '../../data-access/agent-run/agent-run.repository';
import { ChatReplySummary } from '../chat-trace/chat-trace';
import { ChatToolCall } from '../chat-tools/chat-tool-registry';

/** A finished run of the chat agent: what one user message set off and how it ended. */
export interface AgentRunRecord {
  requestId: string | null;
  conversationId: string;
  userMessageId: string | null;
  replyMessageId: string | null;
  summary: ChatReplySummary;
  modelCalls: readonly ModelCallRecord[];
  toolCalls: readonly ChatToolCall[];
}

/**
 * Writes the audit log of the chat agent (`agent_runs`): one row per user message, whatever the
 * outcome. A failed write is logged and never fails the reply, which has been sent already.
 */
@Injectable()
export class AgentRunService {
  private readonly logger = new Logger(AgentRunService.name);

  constructor(private readonly agentRunRepository: AgentRunRepository) {}

  public async record({ summary, modelCalls, toolCalls, ...ids }: AgentRunRecord): Promise<void> {
    try {
      await this.agentRunRepository.create({
        ...ids,
        outcome: summary.outcome,
        durationMs: summary.durationMs,
        firstTextMs: summary.firstTextMs,
        modelCallCount: summary.modelCalls,
        unfinishedModelCallCount: summary.unfinishedModelCalls,
        inputTokens: summary.usage.inputTokens,
        cachedInputTokens: summary.usage.cachedInputTokens,
        outputTokens: summary.usage.outputTokens,
        toolCallCount: summary.toolCalls,
        failedToolCallCount: summary.failedToolCalls,
        modelCalls: [...modelCalls],
        toolCalls: [...toolCalls],
      });
    } catch (error) {
      this.logger.error(
        `Agent run of conversation ${ids.conversationId} was not saved`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
