import { LangfuseSpanProcessor } from '@langfuse/otel';
import { LangfuseVercelAiSdkIntegration } from '@langfuse/vercel-ai-sdk';
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { LangfuseOtelSpanAttributes } from '@langfuse/core';
import { trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { TelemetryOptions } from 'ai';
import { ModelProviderName, TRACING_SHUTDOWN_TIMEOUT_MS } from '../../common/constants';
import { getRequestId } from '../../common/logger';
import { TracingConfigService } from '../../configs/tracing-config/tracing-config.service';

/** What an AI SDK call takes to be traced, or not. */
export interface CallTelemetry {
  telemetry: TelemetryOptions;
  runtimeContext?: { requestId: string };
}

/**
 * Sends the model calls to Langfuse when it is configured (`TracingConfigService`): an
 * OpenTelemetry tracer provider with the Langfuse exporter, and the AI SDK telemetry integration.
 * The integration is never registered globally: only a call that takes `callTelemetry()` is
 * traced, so no other AI SDK call (the embeddings) sends its content by default. Spans go out in
 * batches; the rest is flushed on shutdown.
 */
@Injectable()
export class TracingService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TracingService.name);
  private provider: NodeTracerProvider | null = null;
  private integration: LangfuseVercelAiSdkIntegration | null = null;

  constructor(private readonly config: TracingConfigService) {}

  public onModuleInit(): void {
    const langfuse = this.config.langfuse;
    if (!langfuse) {
      return;
    }
    this.provider = new NodeTracerProvider({
      spanProcessors: [
        new LangfuseSpanProcessor({
          publicKey: langfuse.publicKey,
          secretKey: langfuse.secretKey,
          baseUrl: langfuse.baseUrl,
          environment: langfuse.environment,
        }),
      ],
    });
    this.provider.register();
    this.integration = new LangfuseVercelAiSdkIntegration();
    this.logger.log(
      `Langfuse tracing on (${langfuse.baseUrl ? originOf(langfuse.baseUrl) : 'Langfuse Cloud'}, ` +
        `${langfuse.environment}, ` +
        `${this.config.recordsContent ? 'with' : 'without'} the content of the calls)`,
    );
  }

  /**
   * The trace of one call, named `functionId` (the prompt label), with the request id to find it
   * from the logs; the prompts, messages, tool arguments and replies only where `recordsContent`
   * allows. Telemetry off while tracing is off.
   */
  public callTelemetry(functionId: string): CallTelemetry {
    if (!this.integration) {
      return { telemetry: { isEnabled: false } };
    }
    const recordsContent = this.config.recordsContent;
    return {
      telemetry: {
        isEnabled: true,
        functionId,
        recordInputs: recordsContent,
        recordOutputs: recordsContent,
        includeRuntimeContext: { requestId: true },
        integrations: this.integration,
      },
      runtimeContext: { requestId: getRequestId() ?? 'none' },
    };
  }

  /**
   * Names the model that answered on the span of the model call that is running (the AI SDK runs
   * the provider call in its context): the SDK names the model of the call, the first route of
   * `ModelFallback`, so a fallback would be traced and priced as the first provider. Langfuse
   * takes its model name before the SDK's. Nothing while tracing is off.
   */
  public markServed(provider: ModelProviderName, modelId: string): void {
    if (!this.integration) {
      return;
    }
    trace.getActiveSpan()?.setAttributes({
      [LangfuseOtelSpanAttributes.OBSERVATION_MODEL]: modelId,
      [`${LangfuseOtelSpanAttributes.OBSERVATION_METADATA}.provider`]: provider,
    });
  }

  /**
   * Flushes the spans still in the batch, waiting `TRACING_SHUTDOWN_TIMEOUT_MS` at most; a failed
   * or slow export is logged, never fails or holds up the shutdown.
   */
  public async onApplicationShutdown(): Promise<void> {
    const provider = this.provider;
    if (!provider) {
      return;
    }
    this.provider = null;
    this.integration = null;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${TRACING_SHUTDOWN_TIMEOUT_MS}ms`)),
        TRACING_SHUTDOWN_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([provider.shutdown(), timeout]);
    } catch (error) {
      this.logger.warn(
        `Langfuse flush failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/** `https://host:port`, without a path or credentials in the url. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'an invalid url';
  }
}
