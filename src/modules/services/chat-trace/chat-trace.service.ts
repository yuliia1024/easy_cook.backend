import { Injectable, Logger } from '@nestjs/common';
import { ChatTraceOutcome } from '../../../common/constants';
import { Environments } from '../../../common/types';
import { ApiConfigService } from '../../../configs/api-config/api-config.service';
import { ChatTrace } from './chat-trace';

/**
 * Traces the chain of every chat message where it is safe to log what users wrote and what the
 * models answered: only with `ENV=local`. The trace is logged once, when the reply ends, as one
 * JSON entry (`ChatTraceRecord`) stamped with the request id.
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

  public finish(trace: ChatTrace, outcome: ChatTraceOutcome): void {
    if (trace.enabled) {
      this.logger.log(JSON.stringify(trace.toRecord(outcome), null, 2));
    }
  }
}
