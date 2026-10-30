import { ChatResponseType, ChatStreamEventType } from '../constants';
import { MenuComposition, ResolvedDay } from './menu';

/** The result of a business service that answers without streaming. */
export type ChatResponse =
  | { type: ChatResponseType.Text; message: string }
  | {
      type: ChatResponseType.MenuReady;
      message: string;
      menu: MenuComposition;
      /** The meals of `menu` with their recipe snapshots, to save it as a menu version. */
      days: ResolvedDay[];
    }
  | { type: ChatResponseType.Clarification; message: string; missingFields: string[] }
  | { type: ChatResponseType.Error; code: string; message: string; retryable: boolean };

/**
 * The reply to a chat message, event by event. `menu_ready` carries a menu only after the server
 * composed and validated it (`MenuPlannerService`) and saved it as a draft version.
 */
export type ChatStreamEvent =
  | { type: ChatStreamEventType.TextDelta; content: string }
  | {
      type: ChatStreamEventType.MenuReady;
      menuId: string;
      versionId: string;
      menu: MenuComposition;
    }
  | { type: ChatStreamEventType.Clarification; message: string; missingFields: string[] }
  | { type: ChatStreamEventType.Error; code: string; message: string; retryable: boolean }
  | { type: ChatStreamEventType.Done };
