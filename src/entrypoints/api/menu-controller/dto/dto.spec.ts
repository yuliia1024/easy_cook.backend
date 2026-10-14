import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { MealType } from '../../../../common/constants';
import { MENU_VERSION_ID, RECIPE_ID } from '../../../../test/fixtures';
import {
  CreateMenuDto,
  GenerateMenuDto,
  MenuVersionDto,
  RenameMenuDto,
  ReplaceMealDto,
} from './menu.dto';

/** Property paths of the failing fields, nested ones as `days.0.meals.0.servings`. */
async function errorsOf<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const paths = (errors: ValidationError[], prefix = ''): string[] =>
    errors.flatMap((e) =>
      e.children?.length
        ? paths(e.children, `${prefix}${e.property}.`)
        : [`${prefix}${e.property}`],
    );
  return paths(await validate(plainToInstance(cls, plain)));
}

describe('menu DTOs', () => {
  const meal = { mealType: MealType.Lunch, recipeId: RECIPE_ID, servings: 1.5 };
  const day = { dayIndex: 0, date: '2026-10-20', meals: [meal] };

  describe('MenuVersionDto / CreateMenuDto', () => {
    it('accepts a full menu', async () => {
      expect(await errorsOf(CreateMenuDto, { title: ' Week ', notes: null, days: [day] })).toEqual(
        [],
      );
      expect(await errorsOf(MenuVersionDto, { days: [{ dayIndex: 13, meals: [meal] }] })).toEqual(
        [],
      );
    });

    it('trims the title', () => {
      expect(plainToInstance(CreateMenuDto, { title: ' Week ' }).title).toBe('Week');
    });

    it.each([
      [{ days: [] }, 'days'],
      [{ days: Array(15).fill(day) }, 'days'],
      [{ days: [{ ...day, dayIndex: 14 }] }, 'days.0.dayIndex'],
      [{ days: [{ ...day, dayIndex: 0.5 }] }, 'days.0.dayIndex'],
      [{ days: [{ ...day, date: '20.10.2026' }] }, 'days.0.date'],
      [{ days: [{ ...day, date: '2026-02-30' }] }, 'days.0.date'],
      [{ days: [{ ...day, date: '2026-10-20T00:00:00Z' }] }, 'days.0.date'],
      [{ days: [{ ...day, meals: [] }] }, 'days.0.meals'],
      [{ days: [{ ...day, meals: Array(9).fill(meal) }] }, 'days.0.meals'],
      [{ days: [{ ...day, meals: [{ ...meal, mealType: 'brunch' }] }] }, 'days.0.meals.0.mealType'],
      [{ days: [{ ...day, meals: [{ ...meal, recipeId: 'x' }] }] }, 'days.0.meals.0.recipeId'],
      [{ days: [{ ...day, meals: [{ ...meal, servings: 0.1 }] }] }, 'days.0.meals.0.servings'],
      [{ days: [{ ...day, meals: [{ ...meal, servings: 11 }] }] }, 'days.0.meals.0.servings'],
      [{ days: [{ ...day, meals: [{ ...meal, servings: 1.234 }] }] }, 'days.0.meals.0.servings'],
      [{ days: [day], notes: 'x'.repeat(2001) }, 'notes'],
    ])('rejects %j', async (plain, field) => {
      expect(await errorsOf(MenuVersionDto, plain)).toContain(field);
    });

    it.each([[{ title: '' }], [{ title: '   ' }], [{ title: 'x'.repeat(256) }], [{}]])(
      'rejects the title %j',
      async (plain) => {
        expect(await errorsOf(CreateMenuDto, { ...plain, days: [day] })).toEqual(['title']);
      },
    );
  });

  it('validates a rename', async () => {
    expect(await errorsOf(RenameMenuDto, { title: 'New' })).toEqual([]);
    expect(await errorsOf(RenameMenuDto, { title: null })).toEqual(['title']);
  });

  describe('GenerateMenuDto', () => {
    it('needs only the days', async () => {
      expect(await errorsOf(GenerateMenuDto, { days: 3 })).toEqual([]);
      expect(
        await errorsOf(GenerateMenuDto, {
          days: 14,
          title: 'Plan',
          mealTypes: [MealType.Breakfast, MealType.Snack, MealType.Snack],
          startDate: '2026-10-20',
          instructions: 'quick breakfasts',
        }),
      ).toEqual([]);
      expect(
        await errorsOf(GenerateMenuDto, {
          days: 1,
          title: null,
          mealTypes: null,
          startDate: null,
          instructions: null,
        }),
      ).toEqual([]);
    });

    it.each([
      [{ days: 0 }, 'days'],
      [{ days: 15 }, 'days'],
      [{ days: 2.5 }, 'days'],
      [{ days: 3, mealTypes: [] }, 'mealTypes'],
      [{ days: 3, mealTypes: ['brunch'] }, 'mealTypes'],
      [{ days: 3, mealTypes: Array(9).fill(MealType.Snack) }, 'mealTypes'],
      [{ days: 3, startDate: 'tomorrow' }, 'startDate'],
      [{ days: 3, title: '' }, 'title'],
      [{ days: 3, instructions: 'x'.repeat(2001) }, 'instructions'],
    ])('rejects %j', async (plain, field) => {
      expect(await errorsOf(GenerateMenuDto, plain)).toEqual([field]);
    });
  });

  describe('ReplaceMealDto', () => {
    it('accepts a meal, optionally of a version', async () => {
      expect(await errorsOf(ReplaceMealDto, { dayIndex: 0, position: 0 })).toEqual([]);
      expect(
        await errorsOf(ReplaceMealDto, {
          dayIndex: 13,
          position: 7,
          versionId: MENU_VERSION_ID,
          instructions: 'fish',
        }),
      ).toEqual([]);
    });

    it.each([
      [{ dayIndex: -1, position: 0 }, 'dayIndex'],
      [{ dayIndex: 0, position: 8 }, 'position'],
      [{ dayIndex: 0, position: 0, versionId: 'v1' }, 'versionId'],
    ])('rejects %j', async (plain, field) => {
      expect(await errorsOf(ReplaceMealDto, plain)).toEqual([field]);
    });
  });
});
