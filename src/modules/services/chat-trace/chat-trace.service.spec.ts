import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ChatTraceOutcome, ChatTraceStep } from '../../../common/constants';
import { Environments } from '../../../common/types';
import { ApiConfigService } from '../../../configs/api-config/api-config.service';
import { ChatTraceModule } from './chat-trace.module';
import { ChatTraceService } from './chat-trace.service';

describe('ChatTraceService', () => {
  const serviceFor = (env: Environments): ChatTraceService =>
    new ChatTraceService({ env } as ApiConfigService);

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('is provided by ChatTraceModule', async () => {
    const module = await Test.createTestingModule({ imports: [ChatTraceModule] })
      .useMocker((token) => (token === ApiConfigService ? { env: Environments.LOCAL } : undefined))
      .compile();

    expect(module.get(ChatTraceService)).toBeInstanceOf(ChatTraceService);
  });

  it('logs the whole trace once as JSON with ENV=local', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const service = serviceFor(Environments.LOCAL);
    const trace = service.start('conv-1', 'Plan my day');
    trace.add(ChatTraceStep.Intent, { intent: 'generate_menu' });

    service.finish(trace, ChatTraceOutcome.Replied);

    expect(service.enabled).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({
      conversationId: 'conv-1',
      request: { content: 'Plan my day' },
      outcome: 'replied',
      steps: [{ step: 'intent', data: { intent: 'generate_menu' } }],
    });
  });

  it.each([Environments.DEVELOPMENT, Environments.STAGING, Environments.PRODUCTION])(
    'neither records nor logs with ENV=%s: messages stay out of shared logs',
    (env) => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const service = serviceFor(env);
      const trace = service.start('conv-1', 'secret message');
      trace.add(ChatTraceStep.Intent, {});

      service.finish(trace, ChatTraceOutcome.Replied);

      expect(trace.enabled).toBe(false);
      expect(trace.toRecord(ChatTraceOutcome.Replied).steps).toEqual([]);
      expect(log).not.toHaveBeenCalled();
    },
  );
});
