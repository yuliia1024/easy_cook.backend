import { z } from 'zod';
import {
  CALCULATE_NUTRITION_MAX_ITEMS,
  CALCULATE_NUTRITION_MAX_SERVINGS,
  CHAT_TOOL_MAX_QUANTITY_G,
  CHAT_TOOL_QUERY_MAX_LENGTH,
  DietTag,
  INTENT_REQUEST_MAX_LENGTH,
  MealType,
  PREFERENCE_VALUE_MAX_LENGTH,
  PreferenceChangeAction,
  PreferenceType,
  SEARCH_RECIPES_MAX_RESULTS,
  SEARCH_RECIPES_QUERY_MAX_LENGTH,
} from '../constants';
import { MenuRequestSchema, MenuTargetSchema } from './chat';

/*
 * The arguments the model passes to the chat tools. Every field is required and null when not
 * given, as OpenAI strict function calling asks; the tool registry parses them before a tool runs,
 * so a tool never gets an unchecked value.
 */

const query = z.string().trim().min(1).max(CHAT_TOOL_QUERY_MAX_LENGTH);
const quantityG = z.number().positive().max(CHAT_TOOL_MAX_QUANTITY_G);

export const SearchRecipesInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(SEARCH_RECIPES_QUERY_MAX_LENGTH)
    .nullable()
    .describe(
      'What the user wants, in their own words and language ("something light with chicken", ' +
        '"суп із сочевиці"); null to list recipes by the other fields alone.',
    ),
  mealType: z.enum(MealType).nullable(),
  diet: z.enum(DietTag).nullable().describe('A diet every recipe must satisfy; null for any.'),
  maxKcalPerServing: z.number().positive().nullable(),
  maxPrepTimeMinutes: z.number().int().positive().nullable(),
  limit: z.number().int().min(1).max(SEARCH_RECIPES_MAX_RESULTS).nullable(),
});

export type SearchRecipesInput = z.infer<typeof SearchRecipesInputSchema>;

export const GetRecipeDetailsInputSchema = z.object({
  recipeId: z.uuid().describe('The id of a recipe from search_recipes or the menu.'),
});

export type GetRecipeDetailsInput = z.infer<typeof GetRecipeDetailsInputSchema>;

export const GetFoodNutritionInputSchema = z.object({
  query: query.describe('Part of the food name, e.g. "rice".'),
  quantityG: quantityG.nullable().describe('Grams to give the values for; null for 100 g.'),
});

export type GetFoodNutritionInput = z.infer<typeof GetFoodNutritionInputSchema>;

export const CalculateNutritionInputSchema = z.object({
  items: z
    .array(
      z.object({
        foodId: z.uuid().describe('The id of a food from get_food_nutrition.'),
        quantityG,
      }),
    )
    .min(1)
    .max(CALCULATE_NUTRITION_MAX_ITEMS),
  servings: z
    .number()
    .int()
    .min(1)
    .max(CALCULATE_NUTRITION_MAX_SERVINGS)
    .nullable()
    .describe('Servings the items make; null for 1.'),
});

export type CalculateNutritionInput = z.infer<typeof CalculateNutritionInputSchema>;

/**
 * A request to plan a new menu, the same `request` and `menuRequest` the intent classifier gives
 * (`IntentResultSchema`): the backend plans it on the same path.
 */
export const PlanMenuInputSchema = z.object({
  request: z.string().trim().min(1).max(INTENT_REQUEST_MAX_LENGTH),
  menuRequest: MenuRequestSchema,
});

export type PlanMenuInput = z.infer<typeof PlanMenuInputSchema>;

/** A change to the latest suggested menu, with the parts it changes (`IntentResultSchema`). */
export const ReviseMenuInputSchema = PlanMenuInputSchema.extend({
  targets: z.array(MenuTargetSchema).min(1),
});

export type ReviseMenuInput = z.infer<typeof ReviseMenuInputSchema>;

/**
 * `save_menu` takes no arguments: the backend finds the menu to save in the conversation, so the
 * model never passes or makes up an id. Anything it sends anyway is dropped.
 */
export const SaveMenuInputSchema = z.object({});

export type SaveMenuInput = z.infer<typeof SaveMenuInputSchema>;

/**
 * One change of the saved dietary preferences: what `propose_preference_change` takes from the
 * model, and what an assistant message keeps until the user confirms it (`messages.preference_change`).
 */
export const PreferenceChangeSchema = z.object({
  action: z.enum(PreferenceChangeAction),
  preferenceType: z.enum(PreferenceType),
  value: z
    .string()
    .trim()
    .min(1)
    .max(PREFERENCE_VALUE_MAX_LENGTH)
    .describe('In English; a diet tag for "diet", e.g. "vegetarian"; else e.g. "peanut".'),
});

export type PreferenceChange = z.infer<typeof PreferenceChangeSchema>;

/** Applies the change the latest reply proposed: the backend reads it, never the model. */
export const ApplyPreferenceChangeInputSchema = z.object({});

export type ApplyPreferenceChangeInput = z.infer<typeof ApplyPreferenceChangeInputSchema>;
