import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ChatTraceOutcome, ChatTraceStep } from '../../../common/constants';
import { recordModelCall, runWithRequestId } from '../../../common/logger';
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

  const usage = { inputTokens: 100, cachedInputTokens: 20, outputTokens: 10 };
  const recordCalls = (): void => {
    recordModelCall({
      prompt: 'intent@v1',
      provider: 'openai',
      modelId: 'gpt-test',
      step: 1,
      durationMs: 300,
      usage,
      finishReason: 'stop',
    });
    recordModelCall({
      prompt: 'chat@v1',
      provider: 'openai',
      modelId: 'gpt-test',
      step: 1,
      durationMs: 500,
      usage,
      finishReason: 'stop',
    });
  };

  it('logs the summary line and the whole trace once as JSON with ENV=local', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const service = serviceFor(Environments.LOCAL);

    runWithRequestId('req-1', () => {
      const trace = service.start('conv-1', 'Plan my day');
      trace.add(ChatTraceStep.Intent, { intent: 'generate_menu' });
      recordCalls();

      service.finish(trace, ChatTraceOutcome.Replied);
    });

    expect(service.enabled).toBe(true);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toMatch(
      /^Chat reply replied in \d+ms, no text: 2 model calls, tokens 200 in \(40 cached\) \+ 20 out; 0 tool calls \(conversation conv-1\)$/,
    );
    expect(JSON.parse(log.mock.calls[1][0] as string)).toMatchObject({
      conversationId: 'conv-1',
      request: { content: 'Plan my day' },
      outcome: 'replied',
      summary: { modelCalls: 2, usage: { inputTokens: 200, outputTokens: 20 } },
      modelCalls: [{ prompt: 'intent@v1' }, { prompt: 'chat@v1' }],
      steps: [{ step: 'intent', data: { intent: 'generate_menu' } }],
    });
  });

  it.each([Environments.DEVELOPMENT, Environments.STAGING, Environments.PRODUCTION])(
    'logs only the summary with ENV=%s: messages stay out of shared logs',
    (env) => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const service = serviceFor(env);
      const trace = service.start('conv-1', 'secret message');
      trace.add(ChatTraceStep.Intent, {});

      runWithRequestId('req-1', () => {
        recordCalls();
        service.finish(trace, ChatTraceOutcome.Replied);
      });

      expect(trace.enabled).toBe(false);
      expect(trace.toRecord(ChatTraceOutcome.Replied).steps).toEqual([]);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toMatch(/^Chat reply replied .* 2 model calls/);
      expect(log.mock.calls[0][0]).not.toContain('secret');
    },
  );

  it('warns with the summary of a failed reply', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const service = serviceFor(Environments.PRODUCTION);

    service.finish(service.start('conv-1', 'Hi'), ChatTraceOutcome.Failed);

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^Chat reply failed in \d+ms/));
  });
});
