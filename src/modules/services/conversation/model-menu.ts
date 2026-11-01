import {
  MODEL_MENU_MARKER,
  MODEL_MENU_MAX_TOKENS,
  MODEL_MENU_RECIPE_NAME_MAX_LENGTH,
} from '../../../common/constants';
import { DayComposition, MealComposition, MenuComposition } from '../../../common/types';
import { estimateTokens } from '../../../common/utils';

function recipeName(name: string): string {
  return name.length > MODEL_MENU_RECIPE_NAME_MAX_LENGTH
    ? `${name.slice(0, MODEL_MENU_RECIPE_NAME_MAX_LENGTH - 1)}…`
    : name;
}

/** A deleted recipe keeps only its name. */
function mealPart(meal: MealComposition): string {
  return `${meal.mealType}: ${meal.recipeId ?? 'deleted'} ${recipeName(meal.recipeName)}`;
}

function dayLine(day: DayComposition): string {
  const meals = [...day.meals].sort((a, b) => a.position - b.position).map(mealPart);
  return [`Day ${day.dayIndex + 1}`, ...meals].join(' | ');
}

const omittedLine = (days: number): string => `(${days} more days not shown)`;

/**
 * The menu as the model reads it in the history: the marker with the version, then one line per
 * day, each meal as its type, recipe id and name ("Day 1 | breakfast: <id> Oatmeal | ..."). Days
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
  const lines = [versionId ? `${MODEL_MENU_MARKER} version ${versionId}` : MODEL_MENU_MARKER];
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
