import { LangfuseSpanProcessor } from '@langfuse/otel';
import { LangfuseVercelAiSdkIntegration } from '@langfuse/vercel-ai-sdk';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Span, trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerTelemetry } from 'ai';
import { ModelProviderName, TRACING_SHUTDOWN_TIMEOUT_MS } from '../../common/constants';
import { runWithRequestId } from '../../common/logger';
import { TracingConfigService } from '../../configs/tracing-config/tracing-config.service';
import { fakeConfig } from '../../test/fake-config';
import { TracingModule } from './tracing.module';
import { TracingService } from './tracing.service';

jest.mock('@langfuse/otel', () => ({ LangfuseSpanProcessor: jest.fn() }));
jest.mock('@langfuse/vercel-ai-sdk', () => ({ LangfuseVercelAiSdkIntegration: jest.fn() }));
jest.mock('@opentelemetry/sdk-trace-node', () => ({
  NodeTracerProvider: jest.fn().mockImplementation(() => ({
    register: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('ai', () => ({ registerTelemetry: jest.fn() }));

const providerMock = jest.mocked(NodeTracerProvider);
const KEYS = { LANGFUSE_PUBLIC_KEY: 'pk-lf-1', LANGFUSE_SECRET_KEY: 'sk-lf-1' };

describe('TracingService', () => {
  const configOf = (values: Parameters<typeof fakeConfig>[0]): TracingConfigService =>
    new TracingConfigService(fakeConfig({ ENV: 'production', ...values }));
  const started = (values: Parameters<typeof fakeConfig>[0] = KEYS): TracingService => {
    const service = new TracingService(configOf(values));
    service.onModuleInit();
    return service;
  };
  const lastProvider = (): jest.Mocked<NodeTracerProvider> =>
    providerMock.mock.results.at(-1)?.value as jest.Mocked<NodeTracerProvider>;
  const integration = (): LangfuseVercelAiSdkIntegration =>
    jest.mocked(LangfuseVercelAiSdkIntegration).mock.instances[0];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  it('is provided and exported by TracingModule', async () => {
    const module = await Test.createTestingModule({ imports: [TracingModule] })
      .useMocker((token) => (token === TracingConfigService ? configOf({}) : undefined))
      .compile();

    expect(module.get(TracingService)).toBeInstanceOf(TracingService);
  });

  describe('without Langfuse keys', () => {
    it('starts nothing and turns the telemetry of every call off', async () => {
      const service = started({});

      expect(service.callTelemetry('chat@v3')).toEqual({ telemetry: { isEnabled: false } });
      await service.onApplicationShutdown();
      expect(providerMock).not.toHaveBeenCalled();
      expect(LangfuseVercelAiSdkIntegration).not.toHaveBeenCalled();
    });

    it('turns the telemetry off before the module is initialised', () => {
      expect(new TracingService(configOf(KEYS)).callTelemetry('chat@v3')).toEqual({
        telemetry: { isEnabled: false },
      });
    });
  });

  it('exports the spans to Langfuse and never registers the integration globally', () => {
    started({ ...KEYS, LANGFUSE_BASE_URL: 'http://localhost:3000' });

    expect(LangfuseSpanProcessor).toHaveBeenCalledWith({
      publicKey: 'pk-lf-1',
      secretKey: 'sk-lf-1',
      baseUrl: 'http://localhost:3000',
      environment: 'production',
    });
    expect(providerMock).toHaveBeenCalledWith({
      spanProcessors: [jest.mocked(LangfuseSpanProcessor).mock.instances[0]],
    });
    expect(lastProvider().register).toHaveBeenCalled();
    expect(registerTelemetry).not.toHaveBeenCalled();
  });

  describe('callTelemetry', () => {
    it('names the trace, adds the request id and leaves the content out', () => {
      const service = started();

      const telemetry = runWithRequestId('req-1', () => service.callTelemetry('chat@v3'));

      expect(telemetry).toEqual({
        telemetry: {
          isEnabled: true,
          functionId: 'chat@v3',
          recordInputs: false,
          recordOutputs: false,
          includeRuntimeContext: { requestId: true },
          integrations: integration(),
        },
        runtimeContext: { requestId: 'req-1' },
      });
    });

    it('records the content with ENV=local, and "none" outside a request', () => {
      const telemetry = started({ ...KEYS, ENV: 'local' }).callTelemetry('chat@v3');

      expect(telemetry.telemetry).toEqual(
        expect.objectContaining({ recordInputs: true, recordOutputs: true }),
      );
      expect(telemetry.runtimeContext).toEqual({ requestId: 'none' });
    });
  });

  describe('markServed', () => {
    const activeSpan = (): jest.Mocked<Span> => {
      const span = { setAttributes: jest.fn() } as unknown as jest.Mocked<Span>;
      jest.spyOn(trace, 'getActiveSpan').mockReturnValue(span);
      return span;
    };

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('names the model and the provider that answered on the running model call', () => {
      const span = activeSpan();

      started().markServed(ModelProviderName.DeepSeek, 'deepseek-v4');

      expect(span.setAttributes).toHaveBeenCalledWith({
        'langfuse.observation.model.name': 'deepseek-v4',
        'langfuse.observation.metadata.provider': ModelProviderName.DeepSeek,
      });
    });

    it('does nothing while tracing is off or outside a span', () => {
      const span = activeSpan();

      started({}).markServed(ModelProviderName.DeepSeek, 'deepseek-v4');
      expect(span.setAttributes).not.toHaveBeenCalled();

      jest.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined);
      expect(() => started().markServed(ModelProviderName.OpenAi, 'gpt')).not.toThrow();
    });
  });

  describe('logs', () => {
    const logged = (): string => jest.mocked(Logger.prototype.log).mock.calls.flat().join(' ');

    it('the server and the environment, never the keys', () => {
      started();

      expect(logged()).toContain('Langfuse tracing on (Langfuse Cloud, production, without');
      expect(logged()).not.toMatch(/pk-lf|sk-lf/);
    });

    it('the origin of the server, without credentials or a path', () => {
      started({ ...KEYS, LANGFUSE_BASE_URL: 'https://admin:secret@langfuse.corp:8443/x' });

      expect(logged()).toContain('(https://langfuse.corp:8443, production,');
      expect(logged()).not.toContain('secret');
    });
  });

  describe('shutdown', () => {
    it('flushes the spans once and turns the telemetry off', async () => {
      const service = started();

      await service.onApplicationShutdown();
      await service.onApplicationShutdown();

      expect(lastProvider().shutdown).toHaveBeenCalledTimes(1);
      expect(service.callTelemetry('chat@v3')).toEqual({ telemetry: { isEnabled: false } });
    });

    it('logs a failed flush instead of failing', async () => {
      const service = started();
      lastProvider().shutdown.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(service.onApplicationShutdown()).resolves.toBeUndefined();

      expect(Logger.prototype.warn).toHaveBeenCalledWith('Langfuse flush failed: ECONNREFUSED');
    });

    it('stops waiting for a slow flush after the timeout', async () => {
      jest.useFakeTimers();
      const service = started();
      lastProvider().shutdown.mockReturnValueOnce(new Promise(() => undefined));

      const shutdown = service.onApplicationShutdown();
      await jest.advanceTimersByTimeAsync(TRACING_SHUTDOWN_TIMEOUT_MS);

      await expect(shutdown).resolves.toBeUndefined();
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        `Langfuse flush failed: timed out after ${TRACING_SHUTDOWN_TIMEOUT_MS}ms`,
      );
    });
  });
});
