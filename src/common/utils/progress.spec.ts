import { withProgress } from './progress';

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
