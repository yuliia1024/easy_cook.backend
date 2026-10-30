import {
  MealType,
  MENU_SERVINGS_KCAL_TOLERANCE,
  MENU_SERVINGS_MAX,
  MENU_SERVINGS_MIN,
  MENU_SERVINGS_STEP,
} from '../../../common/constants';
import {
  DayComposition,
  MacroValues,
  MealComposition,
  MenuComposition,
  RecipeSnapshot,
  ResolvedDay,
  ResolvedMeal,
} from '../../../common/types';
import { parseEnum, round, toNumber } from '../../../common/utils';
import { MenuVersionWithDays } from '../../data-access/menu/menu.repository';
import { RecipeWithIngredients } from '../../data-access/recipe/recipe.repository';
import { MACROS, RecipeNutrition } from '../nutrition/nutrition.service';

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

/** What a menu keeps of a recipe; `nutrition` is the recipe without optional ingredients. */
export function snapshotRecipe(
  recipe: RecipeWithIngredients,
  nutrition: RecipeNutrition,
): RecipeSnapshot {
  return {
    id: recipe.id,
    name: recipe.name,
    mealType: recipe.mealType,
    dietType: recipe.dietType,
    allergens: recipe.allergens,
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

const dayKcal = (meals: ResolvedMeal[]): number =>
  meals.reduce((total, meal) => total + meal.recipe.perServing.kcal * meal.servings, 0);

const toServings = (value: number): number =>
  Math.min(
    MENU_SERVINGS_MAX,
    Math.max(MENU_SERVINGS_MIN, Math.round(value / MENU_SERVINGS_STEP) * MENU_SERVINGS_STEP),
  );

/**
 * The servings of every day brought towards `dailyKcal`, within
 * `MENU_SERVINGS_MIN`..`MENU_SERVINGS_MAX` in steps of `MENU_SERVINGS_STEP`: a day off by more
 * than `MENU_SERVINGS_KCAL_TOLERANCE` gets the same servings of every meal (the ratio of the
 * calories, rounded to a step), then one step of one meal at a time, the one that brings the day
 * closest, while the day is off and a step helps. A day close enough keeps its servings.
 * Deterministic.
 */
export function fitServings(days: ResolvedDay[], dailyKcal: number): ResolvedDay[] {
  const isOff = (meals: ResolvedMeal[]): boolean =>
    Math.abs(dayKcal(meals) - dailyKcal) > dailyKcal * MENU_SERVINGS_KCAL_TOLERANCE;
  return days.map((day) => {
    const kcal = dayKcal(day.meals);
    if (!isOff(day.meals) || kcal <= 0) {
      return day;
    }
    const servings = toServings(dailyKcal / kcal);
    const meals = day.meals.map((meal) => ({ ...meal, servings }));
    while (isOff(meals)) {
      const miss = (meal: ResolvedMeal, value: number): number =>
        Math.abs(
          dayKcal(meals) + meal.recipe.perServing.kcal * (value - meal.servings) - dailyKcal,
        );
      const steps = meals
        .flatMap((meal) =>
          [meal.servings + MENU_SERVINGS_STEP, meal.servings - MENU_SERVINGS_STEP]
            .filter((value) => value >= MENU_SERVINGS_MIN && value <= MENU_SERVINGS_MAX)
            .map((value) => ({ meal, value, miss: miss(meal, value) })),
        )
        .filter((step) => step.miss < Math.abs(dayKcal(meals) - dailyKcal))
        .sort((a, b) => a.miss - b.miss);
      if (steps.length === 0) {
        break;
      }
      steps[0].meal.servings = steps[0].value;
    }
    return { ...day, meals };
  });
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
