import {
  DietTag,
  Intent,
  MENU_MAX_DAYS,
  MENU_MIN_DAYS,
  MENU_REQUEST_REQUIRED_FIELDS,
} from '../../../common/constants';
import { IntentResult, MenuRequest } from '../../../common/contracts';
import { ProfileContext } from '../../../common/types';

export type MenuRequestField = keyof MenuRequest;

export interface ResolvedMenuRequest {
  /** The request of the chat with the message on top: what the conversation keeps. */
  chat: MenuRequest;
  /** What the menu is planned for: the profile, then the chat. */
  request: MenuRequest;
  /** The required fields nobody gave, in the order of `MENU_REQUEST_REQUIRED_FIELDS`. */
  missingFields: MenuRequestField[];
  /**
   * Set when the message asked for a number of days a menu cannot have; `offered` is the nearest
   * one and is what `chat` and `request` hold, so a "yes" needs no new number.
   */
  daysOutOfRange: { requested: number; offered: number } | null;
}

export const EMPTY_MENU_REQUEST: MenuRequest = {
  days: null,
  mealTypes: [],
  caloriesKcal: null,
  diets: [],
  excludedIngredients: [],
  dislikedFoods: [],
};

const DIET_TAGS = new Set<string>(Object.values(DietTag));

/** The profile as request fields: the calorie goal and the preferences, never days or meals. */
function fromProfile(profile: ProfileContext | null): MenuRequest {
  if (!profile) {
    return EMPTY_MENU_REQUEST;
  }
  return {
    ...EMPTY_MENU_REQUEST,
    caloriesKcal: profile.nutritionGoal?.caloriesKcal ?? null,
    diets: profile.rules.diets.filter((diet): diet is DietTag => DIET_TAGS.has(diet)),
    excludedIngredients: profile.rules.excludedIngredients,
    dislikedFoods: profile.rules.dislikedFoods,
  };
}

const isGiven = (value: unknown): boolean =>
  Array.isArray(value) ? value.length > 0 : value !== null;

/** Field by field, `top` wins where it has a value; null and an empty list are not one. */
function overlay(base: MenuRequest, top: MenuRequest): MenuRequest {
  const merged = { ...base };
  for (const field of Object.keys(top) as MenuRequestField[]) {
    if (isGiven(top[field])) {
      Object.assign(merged, { [field]: top[field] });
    }
  }
  return merged;
}

/**
 * Brings the menu request together: the profile, then what the chat gathered so far, then the
 * latest message, each winning over the one before where it has a value. Null and empty lists
 * are what nobody said, so they never clear an earlier value. Days outside
 * `MENU_MIN_DAYS`..`MENU_MAX_DAYS` are not cut silently: they become the nearest allowed number
 * and are reported in `daysOutOfRange`. Pure.
 */
export function resolveMenuRequest(
  profile: ProfileContext | null,
  chat: MenuRequest | null,
  message: MenuRequest | null,
): ResolvedMenuRequest {
  let latest = message ?? EMPTY_MENU_REQUEST;
  let daysOutOfRange: ResolvedMenuRequest['daysOutOfRange'] = null;
  if (latest.days !== null && (latest.days < MENU_MIN_DAYS || latest.days > MENU_MAX_DAYS)) {
    const offered = latest.days < MENU_MIN_DAYS ? MENU_MIN_DAYS : MENU_MAX_DAYS;
    daysOutOfRange = { requested: latest.days, offered };
    latest = { ...latest, days: offered };
  }
  const merged = overlay(chat ?? EMPTY_MENU_REQUEST, latest);
  const request = overlay(fromProfile(profile), merged);
  return {
    chat: merged,
    request,
    missingFields: MENU_REQUEST_REQUIRED_FIELDS.filter((field) => !isGiven(request[field])),
    daysOutOfRange,
  };
}

/** The request as one English sentence for the menu planner. Pure. */
export function describeMenuRequest(request: MenuRequest): string {
  const parts = [
    request.days !== null ? `Plan a ${request.days}-day menu` : 'Plan a menu',
    request.mealTypes.length > 0 && `with ${request.mealTypes.join(', ')}`,
    request.caloriesKcal !== null && `of about ${request.caloriesKcal} kcal a day`,
    request.diets.length > 0 && `that is ${request.diets.join(', ').replaceAll('_', ' ')}`,
    request.excludedIngredients.length > 0 && `without ${request.excludedIngredients.join(', ')}`,
    request.dislikedFoods.length > 0 && `avoiding ${request.dislikedFoods.join(', ')}`,
  ];
  return `${parts.filter(Boolean).join(' ')}.`;
}

/**
 * A clarification the chat can already answer is a menu request: when no required field is
 * missing, it becomes `generate_menu` with the gathered request restated, so the user is not
 * asked again for what they said earlier. Anything else is returned as it is. Pure.
 */
export function resolveClarification(
  result: IntentResult,
  resolved: ResolvedMenuRequest,
): IntentResult {
  if (result.intent !== Intent.Clarification || resolved.missingFields.length > 0) {
    return result;
  }
  return {
    ...result,
    intent: Intent.GenerateMenu,
    request: describeMenuRequest(resolved.chat),
    menuRequest: resolved.chat,
  };
}
