import { createUIMessageStream, UIMessageChunk } from 'ai';

const TEXT_ID = 'text';

/** Wraps text deltas into an AI SDK UI message stream: one text part, then `finish`. */
export function toTextStream(deltas: AsyncIterable<string>): ReadableStream<UIMessageChunk> {
  return createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: 'start' });
      writer.write({ type: 'text-start', id: TEXT_ID });
      for await (const delta of deltas) {
        writer.write({ type: 'text-delta', id: TEXT_ID, delta });
      }
      writer.write({ type: 'text-end', id: TEXT_ID });
      writer.write({ type: 'finish' });
    },
  });
}
