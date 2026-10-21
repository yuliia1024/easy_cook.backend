import { z } from 'zod';
import { Intent, INTENT_REQUEST_MAX_LENGTH } from '../constants';

/**
 * What `IntentService` accepts from the model; anything else is invalid output. `request` is the
 * menu request restated from the conversation, set only for `generate_menu`.
 */
export const IntentResultSchema = z.object({
  intent: z.enum(Intent),
  request: z.string().max(INTENT_REQUEST_MAX_LENGTH).nullable(),
});

export type IntentResult = z.infer<typeof IntentResultSchema>;

/**
 * What `MenuPlannerService` accepts from the model: a recipe id for each meal of the day, checked
 * against the recipes of that meal afterwards.
 */
export const MenuPlanSchema = z.object({
  message: z.string(),
  breakfast: z.string(),
  lunch: z.string(),
  dinner: z.string(),
});

export type MenuPlan = z.infer<typeof MenuPlanSchema>;
