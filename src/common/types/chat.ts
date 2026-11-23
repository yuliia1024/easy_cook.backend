import { ChatResponseType, ChatStatusStep, ChatStreamEventType, MealType } from '../constants';
import type { PreferenceChange, WishOffer } from '../contracts';
import { MenuComposition, ResolvedDay } from './menu';
import { ModelProvenance } from './model';

/** The result of a business service that answers without streaming. */
export type ChatResponse =
  | { type: ChatResponseType.Text; message: string }
  | {
      type: ChatResponseType.MenuReady;
      message: string;
      menu: MenuComposition;
      /** The meals of `menu` with their recipe snapshots, to save it as a menu version. */
      days: ResolvedDay[];
      /** The model and the prompt version of the plan, noted on the saved menu version. */
      generatedWith: ModelProvenance;
    }
  | { type: ChatResponseType.Clarification; message: string; missingFields: string[] }
  | { type: ChatResponseType.WishOffer; message: string; offer: WishOffer }
  | { type: ChatResponseType.Error; code: string; message: string; retryable: boolean };

/**
 * The reply to a chat message, event by event. `status` and `menu_pending` are progress only: they
 * are not part of the saved reply. `menu_pending` gives the shape of the menu being planned (for
 * placeholders); a reply without `menu_ready` after it planned no menu. `menu_ready` carries a menu only after the server
 * composed and validated it (`MenuPlannerService`) and saved it as a draft version. `menu_saved`
 * follows a `save_menu` tool call that confirmed the version (or found it confirmed already), so
 * the client can show the menu as saved. `preference_change_proposed` is a change of the dietary
 * preferences waiting for the user's yes (saved with the reply, nothing else is written);
 * `preferences_updated` follows the change applied. `wish_offer_proposed` names the closest
 * recipes when none fits the wishes of a menu request; it waits for the user's answer (saved
 * with the reply) and no menu is planned before it.
 */
export type ChatStreamEvent =
  | { type: ChatStreamEventType.TextDelta; content: string }
  | { type: ChatStreamEventType.Status; step: ChatStatusStep }
  | { type: ChatStreamEventType.MenuPending; days: number; mealTypes: MealType[] }
  | {
      type: ChatStreamEventType.MenuReady;
      menuId: string;
      versionId: string;
      menu: MenuComposition;
    }
  | { type: ChatStreamEventType.MenuSaved; menuId: string; versionId: string }
  | { type: ChatStreamEventType.PreferenceChangeProposed; change: PreferenceChange }
  | { type: ChatStreamEventType.PreferencesUpdated; change: PreferenceChange }
  | { type: ChatStreamEventType.WishOfferProposed; offer: WishOffer }
  | { type: ChatStreamEventType.Clarification; message: string; missingFields: string[] }
  | { type: ChatStreamEventType.Error; code: string; message: string; retryable: boolean }
  | { type: ChatStreamEventType.Done };

/** The events that only report progress; nothing of them is saved. */
export type ChatProgressEvent = Extract<
  ChatStreamEvent,
  { type: ChatStreamEventType.Status | ChatStreamEventType.MenuPending }
>;

/** What a chat tool streams to the client while the model answers: progress and its effects. */
export type ChatToolEvent =
  | ChatProgressEvent
  | Extract<
      ChatStreamEvent,
      {
        type:
          | ChatStreamEventType.MenuSaved
          | ChatStreamEventType.PreferenceChangeProposed
          | ChatStreamEventType.PreferencesUpdated;
      }
    >;
