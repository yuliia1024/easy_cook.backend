import { ModelMessage } from 'ai';
import { z } from 'zod';
import {
  MENU_PLAN_MEAL_TYPES,
  menuDayRetryMessage,
  menuMealRetryMessage,
} from '../../../common/constants';
import { MenuDayPlan, MenuMealPlan } from '../../../common/contracts';
import {
  MenuComposition,
  ProfileContext,
  RecipeSnapshot,
  ResolvedDay,
} from '../../../common/types';
import { ModelCallOptions } from '../../../providers/llm/llm.service';
import { fitServings } from './menu-composition';
import {
  menuDayErrors,
  menuDayModelCall,
  otherDaysRecipeIds,
  replaceDay,
  withoutRecipes,
} from './menu-day';
import {
  fittingDayKcal,
  mealCandidateProblems,
  mealRecipes,
  mealServings,
  menuMealErrors,
  menuMealModelCall,
  menuRecipeIds,
  otherMealsKcal,
  replaceMeal,
} from './menu-meal';
import { candidateProblems, LabelledCandidates, PlannedDay } from './menu-plan';
import { MealSlot, MenuReplacement } from './menu-target';

/** One model call: the input, the schema of the answer and the options. */
export interface ReplacementModelCall<T> {
  input: ModelMessage[];
  schema: z.ZodType<T>;
  options: ModelCallOptions;
}

/**
 * Asks the model with its problems back until the plan has none, or gives up: the app throws, the
 * evals return the last plan to score it.
 */
export type ReplacementModel = <T>(
  call: ReplacementModelCall<T>,
  problemsOf: (plan: T) => string[],
  retryMessage: (problems: string[]) => string,
) => Promise<T>;

/** What `replaceParts` replaces the parts of the menu with. */
export interface ReplacementInput {
  /** The request as the classifier restated it. */
  request: string;
  /** The profile with the rules of the request. */
  profile: ProfileContext;
  previous: ResolvedDay[];
  /** The recipes the rules allow. */
  recipes: RecipeSnapshot[];
  /** The recipes earlier versions of the menu had and `previous` has not. */
  rejectedRecipeIds: ReadonlySet<string>;
  dailyKcal: number | null;
  /** The candidates of every meal among the recipes, labelled by short ids, for one day. */
  label: (recipes: RecipeSnapshot[]) => LabelledCandidates;
  /** The menu with its issues against the profile. */
  compose: (days: ResolvedDay[]) => MenuComposition;
}

/**
 * The menu with the parts replaced and the model's message of every part, in order. Without
 * `days` when a part came back with a recipe that is not a candidate (`unknown`): the parts after
 * it are not asked for.
 */
export interface ReplacedMenu {
  days: ResolvedDay[] | null;
  messages: string[];
  unknown: string[];
}

/**
 * Replaces the days and then the meals of `replacement` in the menu `previous`, one model call
 * with its retries each (`MENU_DAY_PROMPT`, `MENU_MEAL_PROMPT`), every part on the menu the parts
 * before it made, so the whole request ends in one menu. A day is planned among the recipes
 * without its own ones, then without those of the other days, the days replaced before it
 * included, then without the rejected ones (`withoutRecipes`, each step given up for a meal it
 * would leave without recipes), and its servings are fitted to `dailyKcal`; a meal among the
 * recipes of that meal not in the menu yet (`mealRecipes`), then not rejected, that keep its day
 * within the tolerance with their servings (`fittingDayKcal`, `mealServings`), so the last meal of
 * a day replaced brings the day back to its calories. The rejected recipes are
 * `rejectedRecipeIds` and those of the parts replaced before. Every other meal is copied as it is. The errors on the part go back to the model
 * (`menuDayErrors`, `menuMealErrors`). Pure when `label`, `compose` and `ask` are.
 */
export async function replaceParts(
  replacement: MenuReplacement,
  input: ReplacementInput,
  ask: ReplacementModel,
): Promise<ReplacedMenu> {
  const byId = new Map(input.recipes.map((recipe) => [recipe.id, recipe]));
  const messages: string[] = [];
  const rejected = new Set(input.rejectedRecipeIds);
  let days = input.previous;
  for (const dayIndex of replacement.days) {
    const old = days.find((day) => day.dayIndex === dayIndex);
    if (!old) {
      throw new Error(`The menu has no day ${dayIndex}`);
    }
    const { candidates, recipeIds } = input.label(
      withoutRecipes(
        withoutRecipes(
          withoutRecipes(input.recipes, menuRecipeIds([old])),
          otherDaysRecipeIds(days, dayIndex),
        ),
        rejected,
      ),
    );
    const current = days;
    const resolve = (meals: PlannedDay): ResolvedDay[] => {
      const day: ResolvedDay = {
        dayIndex,
        date: old.date,
        meals: MENU_PLAN_MEAL_TYPES.map((mealType) => {
          const recipe = byId.get(recipeIds.get(meals[mealType]) as string) as RecipeSnapshot;
          return { mealType, servings: 1, recipeId: recipe.id, recipe };
        }),
      };
      return replaceDay(
        current,
        input.dailyKcal === null ? day : fitServings([day], input.dailyKcal)[0],
      );
    };
    const plan = await ask<MenuDayPlan>(
      menuDayModelCall(input.request, dayIndex, input.profile, candidates),
      (planned) =>
        menuDayErrors(planned, candidates, dayIndex, (meals) => input.compose(resolve(meals))),
      menuDayRetryMessage,
    );
    const unknown = candidateProblems(
      { message: plan.message, days: [{ dayIndex, meals: plan.meals }] },
      candidates,
    );
    if (unknown.length > 0) {
      return { days: null, messages, unknown };
    }
    days = resolve(plan.meals);
    menuRecipeIds([old]).forEach((id) => rejected.add(id));
    messages.push(plan.message);
  }
  for (const { dayIndex, mealType } of replacement.meals) {
    const day = days.find((current) => current.dayIndex === dayIndex);
    const position = day?.meals.findIndex((meal) => meal.mealType === mealType) ?? -1;
    if (position < 0) {
      throw new Error(`The menu has no ${mealType} on day ${dayIndex}`);
    }
    const otherKcal = otherMealsKcal(day, mealType);
    const { candidates, recipeIds } = input.label(
      fittingDayKcal(
        withoutRecipes(mealRecipes(input.recipes, days, day, mealType), rejected),
        (recipe) => recipe.perServing.kcal,
        otherKcal,
        input.dailyKcal,
      ),
    );
    const current = days;
    const resolve = (recipeId: string): ResolvedDay[] => {
      const recipe = byId.get(recipeIds.get(recipeId) as string) as RecipeSnapshot;
      const servings =
        input.dailyKcal === null
          ? 1
          : mealServings(recipe.perServing.kcal, otherKcal, input.dailyKcal);
      return replaceDay(
        current,
        replaceMeal(day, { mealType, servings, recipeId: recipe.id, recipe }),
      );
    };
    const plan = await ask<MenuMealPlan>(
      menuMealModelCall(input.request, day, mealType, input.profile, candidates[mealType]),
      (planned) =>
        menuMealErrors(planned, candidates[mealType], dayIndex, mealType, position, (recipe) =>
          input.compose(resolve(recipe)),
        ),
      menuMealRetryMessage,
    );
    const unknown = mealCandidateProblems(plan, candidates[mealType], dayIndex, mealType);
    if (unknown.length > 0) {
      return { days: null, messages, unknown };
    }
    days = resolve(plan.recipe);
    const { recipeId: oldId } = day.meals[position];
    if (oldId !== null) {
      rejected.add(oldId);
    }
    messages.push(plan.message);
  }
  return { days, messages, unknown: [] };
}

/** The slots of every meal `replacement` replaces, of the whole days too, in the order of the menu. */
export function replacedSlots(replacement: MenuReplacement, days: ResolvedDay[]): MealSlot[] {
  return days.flatMap(({ dayIndex, meals }) =>
    meals
      .filter(
        ({ mealType }) =>
          replacement.days.includes(dayIndex) ||
          replacement.meals.some(
            (meal) => meal.dayIndex === dayIndex && meal.mealType === mealType,
          ),
      )
      .map(({ mealType }) => ({ dayIndex, mealType })),
  );
}
