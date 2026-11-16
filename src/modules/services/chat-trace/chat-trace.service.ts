import { Injectable, Logger } from '@nestjs/common';
import { ChatTraceOutcome } from '../../../common/constants';
import { ModelCallRecord } from '../../../common/types';
import { getModelCalls } from '../../../common/logger';
import { Environments } from '../../../common/types';
import { ApiConfigService } from '../../../configs/api-config/api-config.service';
import { ChatReplySummary, ChatTrace, describeSummary } from './chat-trace';

/** What `finish` logged, for the audit log of the run (`AgentRunService`). */
export interface ChatTraceReport {
  summary: ChatReplySummary;
  modelCalls: readonly ModelCallRecord[];
}

/**
 * Logs what every chat message cost - time, first text, model calls and their tokens, tool calls -
 * in every environment, as one line once the reply ends (`ChatReplySummary`). Traces the chain of
 * the message only where it is safe to log what users wrote and what the models answered: with
 * `ENV=local`, as one more JSON entry (`ChatTraceRecord`) stamped with the request id. The model
 * calls are the ones of the request (`recordModelCall`): one request is one message.
 */
@Injectable()
export class ChatTraceService {
  private readonly logger = new Logger('ChatTrace');

  constructor(private readonly apiConfigService: ApiConfigService) {}

  public get enabled(): boolean {
    return this.apiConfigService.env === Environments.LOCAL;
  }

  public start(conversationId: string, content: string): ChatTrace {
    return new ChatTrace(this.enabled, conversationId, content);
  }

  public finish(trace: ChatTrace, outcome: ChatTraceOutcome): ChatTraceReport {
    const modelCalls = getModelCalls();
    const summary = trace.summarize(outcome, modelCalls);
    const line = `${describeSummary(summary)} (conversation ${trace.conversationId})`;
    if (outcome === ChatTraceOutcome.Failed) {
      this.logger.warn(line);
    } else {
      this.logger.log(line);
    }
    if (trace.enabled) {
      this.logger.log(JSON.stringify(trace.toRecord(outcome, modelCalls), null, 2));
    }
    return { summary, modelCalls };
  }
}
