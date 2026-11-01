import {
  MODEL_MENU_CHARS_PER_TOKEN,
  MODEL_MENU_MARKER,
  MODEL_MENU_MAX_TOKENS,
  MODEL_MENU_RECIPE_NAME_MAX_LENGTH,
} from '../../../common/constants';
import {
  DayComposition,
  MacroValues,
  MealComposition,
  MenuComposition,
} from '../../../common/types';

/** A low estimate of the tokens of `text`, enough to keep a prompt part within a budget. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / MODEL_MENU_CHARS_PER_TOKEN);
}

function recipeName(name: string): string {
  return name.length > MODEL_MENU_RECIPE_NAME_MAX_LENGTH
    ? `${name.slice(0, MODEL_MENU_RECIPE_NAME_MAX_LENGTH - 1)}…`
    : name;
}

/** A deleted recipe keeps only its name. */
function mealPart(meal: MealComposition): string {
  return `${meal.mealType}: ${meal.recipeId ?? 'deleted'} ${recipeName(meal.recipeName)}`;
}

/** Rounded; values with unknown ingredients are a lower bound. */
function macroText(macros: MacroValues, complete: boolean): string {
  const kcal = `${complete ? '' : 'at least '}${Math.round(macros.kcal)} kcal`;
  return `${kcal}, protein ${Math.round(macros.proteinG)} g, fat ${Math.round(macros.fatG)} g, carbs ${Math.round(macros.carbsG)} g`;
}

function dayLine(day: DayComposition): string {
  const meals = [...day.meals].sort((a, b) => a.position - b.position).map(mealPart);
  return [`Day ${day.dayIndex + 1} (${macroText(day.totals, day.complete)})`, ...meals].join(
    ' | ',
  );
}

function headerLine(menu: MenuComposition, versionId: string | null): string {
  const marker = versionId ? `${MODEL_MENU_MARKER} version ${versionId}` : MODEL_MENU_MARKER;
  const complete = menu.days.every((day) => day.complete);
  return `${marker}, daily average ${macroText(menu.dailyAverage, complete)}`;
}

const omittedLine = (days: number): string => `(${days} more days not shown)`;

/**
 * The menu as the model reads it in the history: the marker with the version and the daily average,
 * then one line per day with its totals, each meal as its type, recipe id and name
 * ("Day 1 (1850 kcal, ...) | breakfast: <id> Oatmeal | ..."), so the model can answer questions
 * about it. Days
 * that would go over `maxTokens` are left out and counted instead. Null for a menu without days.
 */
export function toModelMenu(
  menu: MenuComposition,
  versionId: string | null,
  maxTokens: number = MODEL_MENU_MAX_TOKENS,
): string | null {
  if (menu.days.length === 0) {
    return null;
  }
  const days = [...menu.days].sort((a, b) => a.dayIndex - b.dayIndex);
  const lines = [headerLine(menu, versionId)];
  for (const [index, day] of days.entries()) {
    const line = dayLine(day);
    const rest = days.length - index - 1;
    const withLine = [...lines, line, ...(rest > 0 ? [omittedLine(rest)] : [])].join('\n');
    if (estimateTokens(withLine) > maxTokens) {
      lines.push(omittedLine(days.length - index));
      break;
    }
    lines.push(line);
  }
  return lines.join('\n');
}
