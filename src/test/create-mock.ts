/**
 * A mock whose every method is a `jest.fn()` created on first access, so a spec only has to
 * set up the calls it cares about. Plain values (e.g. getters like `ttlInSec`) go in `props`.
 */
/**
 * Properties that promise/equality machinery probes for (`await`, Jest's `toEqual`, JSON). They
 * must stay undefined, or a mock would look like a thenable, an iterable or an asymmetric matcher.
 */
const NOT_MOCKED = new Set<string | symbol>([
  'then',
  'asymmetricMatch',
  'toJSON',
  'nodeType',
  '$$typeof',
]);

export function createMock<T extends object>(
  props: Partial<Record<keyof T, unknown>> = {},
): jest.Mocked<T> {
  const target: Record<string | symbol, unknown> = { ...props };

  return new Proxy(target, {
    get(obj, prop): unknown {
      if (!(prop in obj) && (typeof prop === 'symbol' || NOT_MOCKED.has(prop))) {
        return undefined;
      }
      if (!(prop in obj)) {
        obj[prop] = jest.fn();
      }
      return obj[prop];
    },
  }) as unknown as jest.Mocked<T>;
}
