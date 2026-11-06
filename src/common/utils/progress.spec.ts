import { withEvents, withProgress } from './progress';

const drain = async <E, T>(
  generator: AsyncGenerator<E, T>,
): Promise<{ events: E[]; result: T }> => {
  const events: E[] = [];
  for (;;) {
    const next: IteratorResult<E, T> = await generator.next();
    if (next.done === true) {
      return { events, result: next.value };
    }
    events.push(next.value);
  }
};

describe('withProgress', () => {
  it('yields the events emitted before and after an await, then returns the result', async () => {
    const { events, result } = await drain(
      withProgress<string, number>(async (emit) => {
        emit('a');
        await new Promise((resolve) => setTimeout(resolve, 1));
        emit('b');
        emit('c');
        return 42;
      }),
    );

    expect(events).toEqual(['a', 'b', 'c']);
    expect(result).toBe(42);
  });

  it('returns the result when nothing is emitted', async () => {
    await expect(drain(withProgress(async () => 'done'))).resolves.toEqual({
      events: [],
      result: 'done',
    });
  });

  it('yields the events emitted before a failure, then throws it', async () => {
    const events: string[] = [];
    const run = async (): Promise<void> => {
      for await (const event of withProgress<string, void>(async (emit) => {
        emit('a');
        await Promise.resolve();
        throw new Error('boom');
      })) {
        events.push(event);
      }
    };

    await expect(run()).rejects.toThrow('boom');
    expect(events).toEqual(['a']);
  });
});

describe('withEvents', () => {
  const drain = async <T, R>(source: AsyncGenerator<T, R>): Promise<{ items: T[]; result: R }> => {
    const items: T[] = [];
    for (let next = await source.next(); ; next = await source.next()) {
      if (next.done === true) {
        return { items, result: next.value };
      }
      items.push(next.value);
    }
  };

  it('yields the values and the events in order and returns the result', async () => {
    const { items, result } = await drain(
      withEvents<string, number, string>(async function* (emit) {
        yield 'a';
        emit(1);
        emit(2);
        yield 'b';
        emit(3);
        return 'done';
      }),
    );

    expect(items).toEqual([
      { value: 'a' },
      { event: 1 },
      { event: 2 },
      { value: 'b' },
      { event: 3 },
    ]);
    expect(result).toBe('done');
  });

  it('yields an event while the source still waits for its next value', async () => {
    let release: () => void = () => undefined;
    const merged = withEvents<string, string, void>(async function* (emit) {
      emit('working');
      await new Promise<void>((resolve) => (release = resolve));
      yield 'result';
    });

    await expect(merged.next()).resolves.toEqual({ done: false, value: { event: 'working' } });
    release();
    await expect(merged.next()).resolves.toEqual({ done: false, value: { value: 'result' } });
  });

  it('throws a failure of the source after the events before it', async () => {
    const merged = withEvents<string, string, void>(async function* (emit) {
      emit('started');
      yield* [];
      throw new Error('boom');
    });

    await expect(merged.next()).resolves.toEqual({ done: false, value: { event: 'started' } });
    await expect(merged.next()).rejects.toThrow('boom');
  });
});
