import { z } from 'zod';
import { Intent } from '../constants';
import { MenuComposition } from '../types';

/** What `IntentService` accepts from the model; anything else is invalid output. */
export const IntentResultSchema = z.object({ intent: z.enum(Intent) });

export type IntentResult = z.infer<typeof IntentResultSchema>;

/** The result of a business service that answers without streaming. */
export type ChatResponse =
  | { type: 'text'; message: string }
  | { type: 'clarification'; message: string; missingFields: string[] }
  | { type: 'error'; code: string; message: string; retryable: boolean };

/**
 * The reply to a chat message, event by event. `menu_ready` carries a menu only after the server
 * composed and validated it (`MenuComposer`); the menu planner is a stub, so nothing emits it yet.
 */
export type ChatStreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'menu_ready'; menu: MenuComposition }
  | { type: 'clarification'; message: string; missingFields: string[] }
  | { type: 'error'; code: string; message: string; retryable: boolean }
  | { type: 'done' };
