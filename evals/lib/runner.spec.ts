import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
} from '../../src/common/exceptions';
import { OpenAiService } from '../../src/providers/open-ai/open-ai.service';
import { createMock } from '../../src/test/create-mock';
import { mapConcurrent, runCase, runSuite } from './runner';
import { RunErrorKind } from './types';
import { buildEchoSuite, EchoCase } from '../test/helpers';

describe('eval runner', () => {
  const openAi = createMock<OpenAiService>();
  const usage = { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100 };
  const testCase: EchoCase = { id: 'c1', tags: ['en'], answer: 'yes' };

  describe('mapConcurrent', () => {
    it('keeps the order and never runs more than the limit at once', async () => {
      let running = 0;
      let peak = 0;
      const delays = [30, 10, 20, 5, 15];

      const results = await mapConcurrent(delays, 2, async (delay) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, delay));
        running -= 1;
        return delay * 2;
      });

      expect(results).toEqual([60, 20, 40, 10, 30]);
      expect(peak).toBe(2);
    });

    it('handles no items', async () => {
      await expect(mapConcurrent([], 3, async () => 1)).resolves.toEqual([]);
    });
  });

  describe('runCase', () => {
    it('scores the output and prices the call', async () => {
      const suite = buildEchoSuite();
      suite.run.mockResolvedValue({
        output: 'yes',
        modelId: 'gpt-4o-mini-2024-07-18',
        latencyMs: 42,
        usage,
      });

      const result = await runCase(suite, testCase, openAi);

      expect(suite.run).toHaveBeenCalledWith(testCase, openAi);
      expect(result).toEqual({
        id: 'c1',
        attempt: 1,
        tags: ['en'],
        pass: true,
        fields: [{ field: 'answer', pass: true, expected: 'yes', actual: 'yes' }],
        output: 'yes',
        error: null,
        modelId: 'gpt-4o-mini-2024-07-18',
        latencyMs: 42,
        usage,
        costUsd: (1000 * 0.15 + 100 * 0.6) / 1_000_000,
        metrics: {},
      });
    });

    it.each([
      ['adds the cost of the judge call', 'gpt-4.1-2025-04-14', (210 + 1000 * 2 + 100 * 8) / 1e6],
      ['has no cost when the judge model has no price', 'judge-x', null],
    ])('%s, keeping its tokens out of the usage', async (_case, judgeModel, cost) => {
      const suite = buildEchoSuite();
      suite.run.mockResolvedValue({
        output: 'yes',
        modelId: 'gpt-4o-mini-2024-07-18',
        latencyMs: 42,
        usage,
        judge: { modelId: judgeModel, usage },
      });

      const result = await runCase(suite, testCase, openAi);

      expect(result.usage).toEqual(usage);
      expect(result.costUsd === null ? null : Number(result.costUsd.toFixed(9))).toBe(cost);
    });

    it('keeps the metrics the suite measured', async () => {
      const suite = buildEchoSuite();
      suite.run.mockResolvedValue({
        output: 'yes',
        modelId: 'm',
        latencyMs: 1,
        usage,
        metrics: { retries: 1 },
      });

      await expect(runCase(suite, testCase, openAi)).resolves.toMatchObject({
        metrics: { retries: 1 },
      });
    });

    it('fails the case when a field fails', async () => {
      const suite = buildEchoSuite();
      suite.run.mockResolvedValue({ output: 'no', modelId: 'm', latencyMs: 1, usage });

      const result = await runCase(suite, testCase, openAi, 2);

      expect(result.attempt).toBe(2);
      expect(result.pass).toBe(false);
      expect(result.costUsd).toBeNull();
    });

    it('fails every field on invalid output and keeps the tokens of the answer', async () => {
      const suite = buildEchoSuite();
      suite.run.mockRejectedValue(
        new AssistantInvalidOutputException({ modelId: 'gpt-4o-mini-2024-07-18', usage }),
      );

      const result = await runCase(suite, testCase, openAi);

      expect(result).toMatchObject({
        id: 'c1',
        pass: false,
        fields: [{ field: 'answer', pass: false, expected: 'yes', actual: null }],
        output: null,
        error: {
          kind: RunErrorKind.InvalidOutput,
          message: expect.stringMatching(/^AssistantInvalidOutputException: /),
        },
        modelId: 'gpt-4o-mini-2024-07-18',
        usage,
        costUsd: (1000 * 0.15 + 100 * 0.6) / 1_000_000,
      });
    });

    it('leaves the cost of invalid output unknown when the API did not report it', async () => {
      const suite = buildEchoSuite();
      suite.run.mockRejectedValue(new AssistantInvalidOutputException());

      await expect(runCase(suite, testCase, openAi)).resolves.toMatchObject({
        modelId: null,
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
        costUsd: null,
      });
    });

    it('records any other failure as a failed call instead of throwing', async () => {
      const suite = buildEchoSuite();
      suite.run.mockRejectedValue(new AssistantUnavailableException(true));

      const result = await runCase(suite, testCase, openAi);

      expect(result).toMatchObject({
        pass: false,
        fields: [],
        error: {
          kind: RunErrorKind.CallFailed,
          message: 'AssistantUnavailableException: Assistant is unavailable',
        },
        modelId: null,
        costUsd: 0,
      });
    });

    it('records a thrown non-error as text', async () => {
      const suite = buildEchoSuite();
      suite.run.mockRejectedValue('boom');

      await expect(runCase(suite, testCase, openAi)).resolves.toMatchObject({
        error: { kind: RunErrorKind.CallFailed, message: 'boom' },
      });
    });
  });

  it('runs every case of a suite as many times as asked, attempt by attempt', async () => {
    const suite = buildEchoSuite();
    suite.run.mockImplementation(async (c: EchoCase) => ({
      output: c.answer,
      modelId: 'm',
      latencyMs: 1,
      usage,
    }));

    const results = await runSuite(suite, [testCase, { ...testCase, id: 'c2' }], openAi, {
      concurrency: 1,
      repeat: 2,
    });

    expect(results.map((result) => [result.id, result.attempt, result.pass])).toEqual([
      ['c1', 1, true],
      ['c2', 1, true],
      ['c1', 2, true],
      ['c2', 2, true],
    ]);
  });
});
