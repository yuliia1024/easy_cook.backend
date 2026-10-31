import { createUIMessageStream, UIMessageChunk } from 'ai';
import {
  CHAT_STATUS_MESSAGES,
  ChatStreamEventType,
  INTERNAL_ERROR_REPLY,
} from '../../common/constants';
import { ChatStreamEvent } from '../../common/types';

const TEXT_ID = 'text';

/**
 * Writes chat events into an AI SDK UI message stream as they arrive:
 * - `text_delta` - one text part;
 * - `status` - a transient `data-status` with `{ step, message }` of the step under way;
 * - `menu_pending` - a transient `data-menu-pending` with `{ days, mealTypes }` of the menu being
 *   planned, to show its placeholders until `data-menu` or the end of the stream;
 * - `clarification` - its message as text, then `data-clarification` with the missing fields;
 * - `menu_ready` - `data-menu` with `{ menuId, versionId, composition }` of the saved draft version;
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
          case ChatStreamEventType.TextDelta:
            writeText(event.content);
            break;
          case ChatStreamEventType.Status:
            writer.write({
              type: 'data-status',
              data: { step: event.step, message: CHAT_STATUS_MESSAGES[event.step] },
              transient: true,
            });
            break;
          case ChatStreamEventType.MenuPending:
            writer.write({
              type: 'data-menu-pending',
              data: { days: event.days, mealTypes: event.mealTypes },
              transient: true,
            });
            break;
          case ChatStreamEventType.Clarification:
            writeText(event.message);
            endText();
            writer.write({
              type: 'data-clarification',
              data: { missingFields: event.missingFields },
            });
            break;
          case ChatStreamEventType.MenuReady:
            endText();
            writer.write({
              type: 'data-menu',
              data: { menuId: event.menuId, versionId: event.versionId, composition: event.menu },
            });
            break;
          case ChatStreamEventType.Error:
            endText();
            failed = true;
            writer.write({
              type: 'data-error',
              data: { code: event.code, message: event.message, retryable: event.retryable },
              transient: true,
            });
            writer.write({ type: 'error', errorText: event.message });
            break;
          case ChatStreamEventType.Done:
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
