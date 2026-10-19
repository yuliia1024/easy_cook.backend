import { createUIMessageStream, UIMessageChunk } from 'ai';
import { INTERNAL_ERROR_REPLY } from '../../common/constants';
import { ChatStreamEvent } from '../../common/contracts';

const TEXT_ID = 'text';

/**
 * Writes chat events into an AI SDK UI message stream as they arrive:
 * - `text_delta` - one text part;
 * - `clarification` - its message as text, then `data-clarification` with the missing fields;
 * - `menu_ready` - `data-menu`;
 * - `error` - a transient `data-error` with the code, then an `error` chunk; nothing follows it;
 * - `done` - `finish`.
 * An unexpected failure becomes an `error` chunk with a generic text.
 */
export function toChatStream(
  events: AsyncIterable<ChatStreamEvent>,
): ReadableStream<UIMessageChunk> {
  return createUIMessageStream({
    execute: async ({ writer }) => {
      let textOpen = false;
      let failed = false;
      const writeText = (delta: string): void => {
        if (!textOpen) {
          writer.write({ type: 'text-start', id: TEXT_ID });
          textOpen = true;
        }
        writer.write({ type: 'text-delta', id: TEXT_ID, delta });
      };
      const endText = (): void => {
        if (textOpen) {
          writer.write({ type: 'text-end', id: TEXT_ID });
          textOpen = false;
        }
      };

      writer.write({ type: 'start' });
      for await (const event of events) {
        switch (event.type) {
          case 'text_delta':
            writeText(event.content);
            break;
          case 'clarification':
            writeText(event.message);
            endText();
            writer.write({
              type: 'data-clarification',
              data: { missingFields: event.missingFields },
            });
            break;
          case 'menu_ready':
            endText();
            writer.write({ type: 'data-menu', data: event.menu });
            break;
          case 'error':
            endText();
            failed = true;
            writer.write({
              type: 'data-error',
              data: { code: event.code, message: event.message, retryable: event.retryable },
              transient: true,
            });
            writer.write({ type: 'error', errorText: event.message });
            break;
          case 'done':
            endText();
            if (!failed) {
              writer.write({ type: 'finish' });
            }
            break;
        }
      }
    },
    onError: () => INTERNAL_ERROR_REPLY,
  });
}
