import { z } from 'zod';
import {
  DietTag,
  Intent,
  INTENT_REQUEST_ITEM_MAX_LENGTH,
  INTENT_REQUEST_MAX_LENGTH,
  MealType,
  MenuTargetScope,
} from '../constants';

const requestItem = z.string().min(1).max(INTENT_REQUEST_ITEM_MAX_LENGTH);

/**
 * The menu request as fields, every detail the user gave in the conversation. Null and empty
 * lists are what the user did not give. `days` has no upper limit: the backend checks it and
 * tells the user, so a request for too many days is not invalid output.
 */
export const MenuRequestSchema = z.object({
  days: z.number().int().positive().nullable(),
  mealTypes: z.array(z.enum(MealType)),
  caloriesKcal: z.number().positive().nullable(),
  diets: z.array(z.enum(DietTag)),
  excludedIngredients: z.array(requestItem),
  dislikedFoods: z.array(requestItem),
});

export type MenuRequest = z.infer<typeof MenuRequestSchema>;

/**
 * The part of the latest menu a `revise_menu` request changes: the whole menu, a day (`dayIndex`,
 * 0 for the first day) or a meal (`mealType`, on the day `dayIndex` or on every day when null).
 * A scope that does not match the fields is not invalid: `resolveIntent` takes it from them.
 */
export const MenuTargetSchema = z.object({
  scope: z.enum(MenuTargetScope),
  dayIndex: z.number().int().nonnegative().nullable(),
  mealType: z.enum(MealType).nullable(),
});

export type MenuTarget = z.infer<typeof MenuTargetSchema>;

/**
 * What `IntentService` accepts from the model; anything else is invalid output. `request` is the
 * menu request restated from the conversation and `menuRequest` the same request as fields, both
 * set only for `generate_menu` and `revise_menu`; `target` is set only for `revise_menu`.
 */
export const IntentResultSchema = z.object({
  intent: z.enum(Intent),
  request: z.string().max(INTENT_REQUEST_MAX_LENGTH).nullable(),
  menuRequest: MenuRequestSchema.nullable(),
  target: MenuTargetSchema.nullable(),
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
