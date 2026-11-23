import { ModelCallRecord } from '../types';
import {
  getCurrentUserId,
  getModelCalls,
  getRequestId,
  recordModelCall,
  resolveRequestId,
  runWithRequestId,
  setCurrentUserId,
} from './request-context';

const call: ModelCallRecord = {
  prompt: 'chat@v1',
  provider: 'openai',
  modelId: 'gpt-test',
  step: 1,
  durationMs: 10,
  usage: null,
  finishReason: 'aborted',
};

describe('request context', () => {
  describe('resolveRequestId', () => {
    it('keeps the id the caller sent, trimmed', () => {
      expect(resolveRequestId('  abc-123 ')).toBe('abc-123');
    });

    it('caps an oversized id', () => {
      expect(resolveRequestId('x'.repeat(500))).toHaveLength(128);
    });

    it.each([undefined, '', '   ', ['a', 'b']])('generates a uuid for %p', (inbound) => {
      expect(resolveRequestId(inbound)).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  it('exposes the id to everything awaited inside the callback', async () => {
    const seen = await runWithRequestId('req-1', async () => {
      await Promise.resolve();
      return getRequestId();
    });

    expect(seen).toBe('req-1');
  });

  it('has no id outside a request', () => {
    expect(getRequestId()).toBeUndefined();
  });

  it('collects the model calls of each request apart', async () => {
    const [first, second] = await Promise.all(
      ['req-1', 'req-2'].map((id, i) =>
        runWithRequestId(id, async () => {
          recordModelCall({ ...call, step: i + 1 });
          await Promise.resolve();
          return getModelCalls();
        }),
      ),
    );

    expect(first).toEqual([{ ...call, step: 1 }]);
    expect(second).toEqual([{ ...call, step: 2 }]);
  });

  it('records nothing outside a request', () => {
    recordModelCall(call);

    expect(getModelCalls()).toEqual([]);
  });

  it('keeps the signed-in user of each request apart', async () => {
    const seen = await Promise.all(
      ['u1', 'u2'].map((userId) =>
        runWithRequestId(`r-${userId}`, async () => {
          expect(getCurrentUserId()).toBeUndefined();
          setCurrentUserId(userId);
          await Promise.resolve();
          return getCurrentUserId();
        }),
      ),
    );

    expect(seen).toEqual(['u1', 'u2']);
  });

  it('has no user outside a request', () => {
    setCurrentUserId('u1');

    expect(getCurrentUserId()).toBeUndefined();
  });
});
