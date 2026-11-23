import { z } from 'zod';
import {
  DietTag,
  Intent,
  INTENT_REQUEST_ITEM_MAX_LENGTH,
  INTENT_REQUEST_MAX_LENGTH,
  MealType,
  MenuTargetScope,
  SUMMARY_MAX_LENGTH,
  WISH_OFFER_RECIPES_MAX,
  WishOfferAnswer,
} from '../constants';

const requestItem = z.string().min(1).max(INTENT_REQUEST_ITEM_MAX_LENGTH);

/**
 * The menu request as fields, every detail the user gave in the conversation. Null and empty
 * lists are what the user did not give. `days` has no limits: the backend checks it and tells the
 * user (`resolveMenuRequest`), so a request for too many days, or for 0, is not invalid output.
 * The chat keeps the same fields as `conversations.menu_request`.
 */
export const MenuRequestSchema = z.object({
  days: z.number().int().nullable(),
  mealTypes: z.array(z.enum(MealType)),
  caloriesKcal: z.number().positive().nullable(),
  diets: z.array(z.enum(DietTag)),
  excludedIngredients: z.array(requestItem),
  dislikedFoods: z.array(requestItem),
  /** What the user asks for in their words ("more fish"): the menu planner searches the recipes by it. */
  wishes: requestItem.nullable(),
});

export type MenuRequest = z.infer<typeof MenuRequestSchema>;

/**
 * A part of the latest menu a `revise_menu` request changes: the whole menu (a meal on every day
 * too), a day (`dayIndex`, 0 for the first day) or a meal (`mealType` on the day `dayIndex`; a
 * day not named is asked for on a menu of more days). A scope that does not match the fields is
 * not invalid: `resolveIntent` takes it from them. The model only names the parts; the backend
 * decides what is replaced (`resolveReplaceTarget`).
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
 * set only for `generate_menu` and `revise_menu`; `targets`, every part of the menu the change
 * names, only for `revise_menu`; `wishOffer`, the answer to a wish offer of the latest reply.
 */
export const IntentResultSchema = z.object({
  intent: z.enum(Intent),
  request: z.string().max(INTENT_REQUEST_MAX_LENGTH).nullable(),
  menuRequest: MenuRequestSchema.nullable(),
  targets: z.array(MenuTargetSchema).nullable(),
  wishOffer: z.enum(WishOfferAnswer).nullable(),
});

export type IntentResult = z.infer<typeof IntentResultSchema>;

/**
 * Made instead of a menu when no recipe fits the `wishes` of the request: the closest allowed
 * recipes, kept with the reply (`messages.wish_offer`) until the user accepts or declines them.
 */
export const WishOfferSchema = z.object({
  wishes: z.string().min(1),
  recipes: z
    .array(z.object({ id: z.uuid(), name: z.string().min(1), mealType: z.enum(MealType) }))
    .min(1)
    .max(WISH_OFFER_RECIPES_MAX),
});

export type WishOffer = z.infer<typeof WishOfferSchema>;

/**
 * What `MenuPlannerService` accepts from the model: a recipe id for each meal of every day, checked
 * afterwards against the candidates of that meal and against the number of days requested
 * (`resolvePlanDays`). Each day carries its `dayIndex` (0 for the first day).
 */
export const MenuPlanSchema = z.object({
  message: z.string(),
  days: z.array(
    z.object({
      dayIndex: z.number().int(),
      meals: z.object({
        breakfast: z.string(),
        lunch: z.string(),
        snack: z.string(),
        dinner: z.string(),
      }),
    }),
  ),
});

export type MenuPlan = z.infer<typeof MenuPlanSchema>;

/**
 * What `replaceParts` accepts from the model: a recipe id for each meal of the one
 * day it plans again, checked afterwards against the candidates of that meal (`menuDayErrors`).
 */
export const MenuDayPlanSchema = z.object({
  message: z.string(),
  meals: MenuPlanSchema.shape.days.element.shape.meals,
});

export type MenuDayPlan = z.infer<typeof MenuDayPlanSchema>;

/**
 * What `replaceParts` accepts from the model: the recipe id of the one meal it
 * replaces, checked afterwards against the candidates (`menuMealErrors`).
 */
export const MenuMealPlanSchema = z.object({
  message: z.string(),
  recipe: z.string(),
});

export type MenuMealPlan = z.infer<typeof MenuMealPlanSchema>;

/** What `ConversationSummaryService` accepts from the model: the summary of the older messages. */
export const SummaryResultSchema = z.object({
  summary: z.string().min(1).max(SUMMARY_MAX_LENGTH),
});

export type SummaryResult = z.infer<typeof SummaryResultSchema>;
