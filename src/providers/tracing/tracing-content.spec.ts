import { TypeValidationError } from '@ai-sdk/provider';
import { Logger } from '@nestjs/common';
import { context, trace } from '@opentelemetry/api';
import { InMemorySpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-node';
import { LanguageModel, tool } from 'ai';
import { z } from 'zod';
import { ModelProviderName } from '../../common/constants';
import { runWithRequestId } from '../../common/logger';
import { ModelProvidersConfigService } from '../../configs/model-providers-config/model-providers-config.service';
import { TracingConfigService } from '../../configs/tracing-config/tracing-config.service';
import { fakeConfig } from '../../test/fake-config';
import { LlmService } from '../llm/llm.service';
import { TracingService } from './tracing.service';

type FakeModel = Extract<LanguageModel, { specificationVersion: 'v4' }>;
type GenerateResult = Awaited<ReturnType<FakeModel['doGenerate']>>;
type StreamPart =
  Awaited<ReturnType<FakeModel['doStream']>>['stream'] extends ReadableStream<infer T> ? T : never;

const mockExporter: { current?: InMemorySpanExporter } = {};
const doGenerate = jest.fn<Promise<GenerateResult>, []>();
const doStream = jest.fn<ReturnType<FakeModel['doStream']>, []>();
const mockModel: FakeModel = {
  specificationVersion: 'v4',
  provider: 'openai.responses',
  modelId: 'gpt-test',
  supportedUrls: {},
  doGenerate,
  doStream,
};

// Only the network is replaced: the spans go to memory, the model is a fake one.
jest.mock('@langfuse/otel', () => {
  const otel = jest.requireActual<typeof import('@opentelemetry/sdk-trace-node')>(
    '@opentelemetry/sdk-trace-node',
  );
  return {
    LangfuseSpanProcessor: class extends otel.SimpleSpanProcessor {
      constructor() {
        const exporter = new otel.InMemorySpanExporter();
        super(exporter);
        mockExporter.current = exporter;
      }
    },
  };
});
jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => ({ responses: () => mockModel }),
}));

/** The real Langfuse integration of the AI SDK: what of a call is in its spans. */
describe('content of the traces', () => {
  const PROMPT = { name: 'brief', version: 2, instructions: 'SECRET_INSTRUCTIONS' };
  const OPTIONS = { prompt: PROMPT, maxOutputTokens: 100 };
  const usage = {
    inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 3, text: 3, reasoning: undefined },
  };
  const KEYS = { LANGFUSE_PUBLIC_KEY: 'pk-lf-1', LANGFUSE_SECRET_KEY: 'sk-lf-1' };
  const tracings: TracingService[] = [];

  const createLlm = (env: string): LlmService => {
    const tracing = new TracingService(new TracingConfigService(fakeConfig({ ...KEYS, ENV: env })));
    tracing.onModuleInit();
    tracings.push(tracing);
    return new LlmService(
      {
        openAiApiKey: 'key',
        providers: [ModelProviderName.OpenAi],
      } as ModelProvidersConfigService,
      tracing,
    );
  };
  const spans = (): ReadableSpan[] => mockExporter.current?.getFinishedSpans() ?? [];
  /** Everything of the spans that leaves for Langfuse. */
  const exported = (): string =>
    JSON.stringify(
      spans().map(({ name, attributes, status, events }) => ({ name, attributes, status, events })),
    );
  const generated = (text: string): GenerateResult => ({
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage,
    warnings: [],
  });
  const streamed = (...parts: StreamPart[]): Awaited<ReturnType<FakeModel['doStream']>> => ({
    stream: new ReadableStream({
      start(controller): void {
        [{ type: 'stream-start' as const, warnings: [] }, ...parts].forEach((part) =>
          controller.enqueue(part),
        );
        controller.close();
      },
    }),
  });
  const toolCall = (input: string): StreamPart[] => [
    { type: 'tool-call', toolCallId: 'call_1', toolName: 'search', input },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
  ];
  const text = (delta: string): StreamPart[] => [
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta },
    { type: 'text-end', id: 't' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
  ];
  const structured = (
    llm: LlmService,
    schema: z.ZodType = z.object({ a: z.string() }),
  ): Promise<unknown> =>
    runWithRequestId('req-1', () => llm.generateStructuredResult('SECRET_INPUT', schema, OPTIONS));
  const withTools = async (llm: LlmService, execute: () => Promise<string>): Promise<void> => {
    const deltas = llm.streamWithTools('SECRET_INPUT', {
      ...OPTIONS,
      maxSteps: 3,
      tools: { search: tool({ inputSchema: z.object({ query: z.string() }), execute }) },
    });
    for await (const delta of deltas) {
      expect(delta).toBe('SECRET_OUTPUT');
    }
  };

  beforeEach(() => {
    doGenerate.mockReset();
    doStream.mockReset();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(async () => {
    await Promise.all(tracings.splice(0).map((tracing) => tracing.onApplicationShutdown()));
    // The global tracer provider is set once: without this the next test would use the one shut down.
    trace.disable();
    context.disable();
  });

  it('is there with ENV=local', async () => {
    doGenerate.mockResolvedValue(generated('{"a":"SECRET_OUTPUT"}'));

    await structured(createLlm('local'));

    expect(exported()).toContain('SECRET_INPUT');
    expect(exported()).toContain('SECRET_OUTPUT');
  });

  describe('outside ENV=local', () => {
    afterEach(() => {
      expect(spans().length).toBeGreaterThan(0);
      expect(exported()).not.toContain('SECRET');
    });

    it('is not, only the prompt label, the request id and the model that answered', async () => {
      doGenerate.mockResolvedValue(generated('{"a":"SECRET_OUTPUT"}'));

      await structured(createLlm('production'));

      expect(exported()).toContain('brief@v2');
      expect(exported()).toContain('req-1');
      expect(
        spans().map(({ attributes }) => attributes['langfuse.observation.model.name']),
      ).toContain('gpt-test');
    });

    it('is not in an answer that does not match the schema', async () => {
      doGenerate.mockResolvedValue(generated('{"a":"SECRET_OUTPUT"}'));

      await expect(
        structured(createLlm('production'), z.object({ a: z.number() })),
      ).rejects.toThrow();
    });

    it('is not in the error of a response the provider could not read', async () => {
      doGenerate.mockRejectedValue(
        new TypeValidationError({ value: 'SECRET_OUTPUT', cause: new Error('SECRET_CAUSE') }),
      );

      await expect(structured(createLlm('production'))).rejects.toThrow();
    });

    it('is not in the arguments and the result of a tool', async () => {
      doStream
        .mockResolvedValueOnce(streamed(...toolCall('{"query":"SECRET_QUERY"}')))
        .mockResolvedValueOnce(streamed(...text('SECRET_OUTPUT')));

      await withTools(createLlm('production'), async () => 'SECRET_RESULT');

      expect(exported()).toContain('execute_tool search');
    });

    it('is not in the error of a tool', async () => {
      doStream
        .mockResolvedValueOnce(streamed(...toolCall('{"query":"SECRET_QUERY"}')))
        .mockResolvedValueOnce(streamed(...text('SECRET_OUTPUT')));

      await withTools(createLlm('production'), async () => {
        throw new Error('SECRET_ERROR');
      });
    });

    it('is not in the arguments a tool does not take', async () => {
      doStream
        .mockResolvedValueOnce(streamed(...toolCall('{"query":{"x":"SECRET_QUERY"}}')))
        .mockResolvedValueOnce(streamed(...text('SECRET_OUTPUT')));

      await withTools(createLlm('production'), async () => 'SECRET_RESULT');
    });

    it('is not in a stream that fails midway', async () => {
      doStream.mockResolvedValue(
        streamed(...text('SECRET_OUTPUT').slice(0, 2), {
          type: 'error',
          error: new Error('SECRET_ERROR'),
        }),
      );

      await expect(withTools(createLlm('production'), async () => '')).rejects.toThrow();
    });
  });
});
