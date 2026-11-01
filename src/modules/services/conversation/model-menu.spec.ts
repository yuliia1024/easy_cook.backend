import { MealType, MENU_MAX_DAYS, MODEL_MENU_MAX_TOKENS } from '../../../common/constants';
import { DayComposition, MealComposition, MenuComposition } from '../../../common/types';
import { MENU_VERSION_ID, RECIPE_ID } from '../../../test/fixtures';
import { estimateTokens } from '../../../common/utils';
import { toModelMenu } from './model-menu';

const macros = { kcal: 400, proteinG: 20, fatG: 10, carbsG: 50 };
const RECIPE_ID_2 = '22222222-2222-4222-8222-222222222222';

function meal(overrides: Partial<MealComposition> = {}): MealComposition {
  return {
    position: 0,
    mealType: MealType.Lunch,
    recipeId: RECIPE_ID,
    recipeName: 'Rice with vegetables',
    servings: 1,
    nutrition: macros,
    complete: true,
    ...overrides,
  };
}

function day(dayIndex: number, meals: MealComposition[] = [meal()]): DayComposition {
  return { dayIndex, date: null, meals, totals: macros, complete: true };
}

function menu(days: DayComposition[]): MenuComposition {
  return { days, dailyAverage: macros, issues: [] };
}

const fullDay = (dayIndex: number): DayComposition =>
  day(
    dayIndex,
    [MealType.Breakfast, MealType.Lunch, MealType.Snack, MealType.Dinner].map(
      (mealType, position) =>
        meal({ position, mealType, recipeName: `A rather long recipe name number ${position}` }),
    ),
  );

describe('toModelMenu', () => {
  it('writes the version and one line per day, each meal as type, recipe id and name', () => {
    expect(
      toModelMenu(
        menu([
          day(0, [
            meal({ position: 0, mealType: MealType.Breakfast, recipeName: 'Oatmeal' }),
            meal({ position: 1, recipeId: RECIPE_ID_2 }),
          ]),
          day(1),
        ]),
        MENU_VERSION_ID,
      ),
    ).toBe(
      [
        `[menu] version ${MENU_VERSION_ID}`,
        `Day 1 | breakfast: ${RECIPE_ID} Oatmeal | lunch: ${RECIPE_ID_2} Rice with vegetables`,
        `Day 2 | lunch: ${RECIPE_ID} Rice with vegetables`,
      ].join('\n'),
    );
  });

  it('orders days by index and meals by position', () => {
    expect(
      toModelMenu(
        menu([
          day(1),
          day(0, [
            meal({ position: 1, mealType: MealType.Dinner, recipeName: 'Soup' }),
            meal({ position: 0, mealType: MealType.Breakfast, recipeName: 'Eggs' }),
          ]),
        ]),
        null,
      ),
    ).toBe(
      [
        '[menu]',
        `Day 1 | breakfast: ${RECIPE_ID} Eggs | dinner: ${RECIPE_ID} Soup`,
        `Day 2 | lunch: ${RECIPE_ID} Rice with vegetables`,
      ].join('\n'),
    );
  });

  it('marks a deleted recipe and cuts a long name', () => {
    expect(
      toModelMenu(menu([day(0, [meal({ recipeId: null, recipeName: 'x'.repeat(60) })])]), null),
    ).toBe(`[menu]\nDay 1 | lunch: deleted ${'x'.repeat(39)}…`);
  });

  it('returns null for a menu without days', () => {
    expect(toModelMenu(menu([]), MENU_VERSION_ID)).toBeNull();
  });

  it('keeps the longest menu with full ids and long names whole within the budget', () => {
    const days = Array.from({ length: MENU_MAX_DAYS }, (_, index) => fullDay(index));

    const text = toModelMenu(menu(days), MENU_VERSION_ID);

    expect(text?.split('\n')).toHaveLength(MENU_MAX_DAYS + 1);
    expect(estimateTokens(text ?? '')).toBeLessThanOrEqual(MODEL_MENU_MAX_TOKENS);
  });

  it('leaves out the days over the budget and counts them', () => {
    const days = Array.from({ length: 5 }, (_, index) => fullDay(index));
    const maxTokens = estimateTokens(
      [`[menu] version ${MENU_VERSION_ID}`, ...days.slice(0, 2).map(() => 'x'.repeat(250))].join(
        '\n',
      ),
    );

    const text = toModelMenu(menu(days), MENU_VERSION_ID, maxTokens) ?? '';

    const lines = text.split('\n');
    expect(lines.at(-1)).toMatch(/^\(\d more days not shown\)$/);
    const shown = lines.filter((line) => line.startsWith('Day ')).length;
    expect(lines.at(-1)).toBe(`(${5 - shown} more days not shown)`);
    expect(shown).toBeGreaterThan(0);
    expect(estimateTokens(text)).toBeLessThanOrEqual(maxTokens);
  });
});
