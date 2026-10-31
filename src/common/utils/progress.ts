/**
 * Runs `run` and yields every event it emits while it runs, in order, then returns its result
 * (`yield*` gives it back). A rejection of `run` is thrown once the events before it are yielded.
 */
export async function* withProgress<E, T>(
  run: (emit: (event: E) => void) => Promise<T>,
): AsyncGenerator<E, T> {
  const queue: E[] = [];
  let settled = false;
  let wake: (() => void) | null = null;
  const notify = (): void => {
    wake?.();
    wake = null;
  };
  const result = run((event) => {
    queue.push(event);
    notify();
  });
  const settle = (): void => {
    settled = true;
    notify();
  };
  result.then(settle, settle);

  while (true) {
    while (queue.length > 0) {
      yield queue.shift() as E;
    }
    if (settled) {
      return result;
    }
    await new Promise<void>((resolve) => (wake = resolve));
  }
}
