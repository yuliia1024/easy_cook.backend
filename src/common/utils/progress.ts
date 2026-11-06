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

/** A value the source yielded, or an event emitted while it ran. */
export type Merged<T, E> = { value: T; event?: never } | { event: E; value?: never };

/**
 * `withProgress` for a generator: runs `start`, yields every value of its generator and every event
 * it emits, each as soon as it comes, so an event is not held back until the next value; then
 * returns its result. An event emitted before a value comes first. A failure of the source is
 * thrown once the events before it are yielded.
 */
export async function* withEvents<T, E, R>(
  start: (emit: (event: E) => void) => AsyncGenerator<T, R>,
): AsyncGenerator<Merged<T, E>, R> {
  const queue: E[] = [];
  let wake: (() => void) | null = null;
  const source = start((event) => {
    queue.push(event);
    wake?.();
    wake = null;
  });
  let pending = source.next();

  while (true) {
    while (queue.length > 0) {
      yield { event: queue.shift() as E };
    }
    const next = await Promise.race([
      pending,
      new Promise<null>((resolve) => (wake = () => resolve(null))),
    ]);
    wake = null;
    if (next === null) {
      continue;
    }
    while (queue.length > 0) {
      yield { event: queue.shift() as E };
    }
    if (next.done === true) {
      return next.value;
    }
    yield { value: next.value };
    pending = source.next();
  }
}
