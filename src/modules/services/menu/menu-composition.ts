import { MealType } from '../../../common/constants';
import {
  DayComposition,
  MacroValues,
  MealComposition,
  MenuComposition,
  MenuDayDraft,
  RecipeSnapshot,
} from '../../../common/types';
import { parseEnum, round, toNumber } from '../../../common/utils';
import { MenuVersionWithDays } from '../../data-access/menu/menu.repository';
import { RecipeWithIngredients } from '../../data-access/recipe/recipe.repository';
import { MACROS, RecipeNutrition } from '../nutrition/nutrition.service';

/** A day whose meals are resolved to recipe snapshots. */
export interface ResolvedDay {
  dayIndex: number;
  date: Date | null;
  meals: ResolvedMeal[];
}

export interface ResolvedMeal {
  mealType: MealType;
  servings: number;
  /** Null when the recipe was deleted and only its snapshot is left. */
  recipeId: string | null;
  recipe: RecipeSnapshot;
}

const emptyMacros = (): MacroValues => ({ kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 });

const roundMacros = (macros: MacroValues): MacroValues => ({
  kcal: round(macros.kcal),
  proteinG: round(macros.proteinG),
  fatG: round(macros.fatG),
  carbsG: round(macros.carbsG),
});

/** `YYYY-MM-DD` of a date-only column. */
export const toIsoDate = (date: Date | null): string | null =>
  date ? date.toISOString().slice(0, 10) : null;

/** What a menu version keeps of a recipe; `nutrition` is the recipe without optional ingredients. */
export function snapshotRecipe(
  recipe: RecipeWithIngredients,
  nutrition: RecipeNutrition,
): RecipeSnapshot {
  return {
    id: recipe.id,
    name: recipe.name,
    mealType: recipe.mealType,
    dietType: recipe.dietType,
    servings: recipe.servings,
    prepTimeMinutes: recipe.prepTimeMinutes,
    perServing: nutrition.perServing,
    complete: nutrition.complete,
    ingredients: recipe.ingredients.map((ingredient) => ({
      foodItemId: ingredient.foodItemId,
      foodName: ingredient.foodItem.name,
      foodNameEn: ingredient.foodItem.nameEn,
      state: ingredient.foodItem.state,
      quantityG: toNumber(ingredient.quantityG),
      isOptional: ingredient.isOptional,
    })),
  };
}

/**
 * Calories and macros of every meal (per serving of the recipe times the servings eaten), of
 * every day and the daily average. Deterministic; rounding only on output.
 */
export function composeMenu(days: ResolvedDay[]): Omit<MenuComposition, 'issues'> {
  const average = emptyMacros();

  const composed = days.map((day): DayComposition => {
    const totals = emptyMacros();
    const meals = day.meals.map((meal, position): MealComposition => {
      const nutrition = emptyMacros();
      for (const macro of MACROS) {
        nutrition[macro] = meal.recipe.perServing[macro] * meal.servings;
        totals[macro] += nutrition[macro];
      }
      return {
        position,
        mealType: meal.mealType,
        recipeId: meal.recipeId,
        recipeName: meal.recipe.name,
        servings: meal.servings,
        nutrition: roundMacros(nutrition),
        complete: meal.recipe.complete,
      };
    });

    for (const macro of MACROS) {
      average[macro] += totals[macro] / Math.max(days.length, 1);
    }

    return {
      dayIndex: day.dayIndex,
      date: toIsoDate(day.date),
      meals,
      totals: roundMacros(totals),
      complete: meals.every((meal) => meal.complete),
    };
  });

  return { days: composed, dailyAverage: roundMacros(average) };
}

/** A saved version, its meals resolved to the snapshots it was built with. */
export function resolveVersion(version: MenuVersionWithDays): ResolvedDay[] {
  return version.days.map((day) => ({
    dayIndex: day.dayIndex,
    date: day.date,
    meals: day.meals.map((meal) => ({
      mealType: parseEnum(MealType, meal.mealType, 'meal type'),
      servings: toNumber(meal.servings),
      recipeId: meal.recipeId,
      recipe: meal.recipeSnapshot as unknown as RecipeSnapshot,
    })),
  }));
}

/**
 * A saved version as the draft of the next one: live recipes are referenced by id (and so
 * re-read), deleted ones keep their snapshot.
 */
export function toDraft(version: MenuVersionWithDays): MenuDayDraft[] {
  return resolveVersion(version).map((day) => ({
    dayIndex: day.dayIndex,
    date: day.date,
    meals: day.meals.map(({ mealType, servings, recipeId, recipe }) =>
      recipeId
        ? { mealType, servings, recipeId }
        : { mealType, servings, recipeId: null, recipeSnapshot: recipe },
    ),
  }));
}
