import { UIMessageChunk } from 'ai';
import { toTextStream } from './text-stream';

const read = async (stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> => {
  const chunks: UIMessageChunk[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<UIMessageChunk>) {
    chunks.push(chunk);
  }
  return chunks;
};

describe('toTextStream', () => {
  it('streams the deltas as one text part', async () => {
    const chunks = await read(
      toTextStream(
        (async function* () {
          yield 'Day 1: ';
          yield 'oatmeal';
        })(),
      ),
    );

    expect(chunks).toEqual([
      expect.objectContaining({ type: 'start' }),
      { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: 'Day 1: ' },
      { type: 'text-delta', id: 'text', delta: 'oatmeal' },
      { type: 'text-end', id: 'text' },
      expect.objectContaining({ type: 'finish' }),
    ]);
  });

  it('ends with an error chunk when the deltas fail', async () => {
    const chunks = await read(
      toTextStream(
        (async function* () {
          yield 'Day 1: ';
          throw new Error('rate limited');
        })(),
      ),
    );

    expect(chunks.at(-1)).toEqual(expect.objectContaining({ type: 'error' }));
  });
});
