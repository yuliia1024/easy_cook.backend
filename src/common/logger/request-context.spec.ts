import { getRequestId, resolveRequestId, runWithRequestId } from './request-context';

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
});
