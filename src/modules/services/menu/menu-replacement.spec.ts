import {
  MENU_DAY_PROMPT,
  MENU_MEAL_PROMPT,
  MENU_PLAN_MEAL_TYPES,
  MealType,
  menuDayRetryMessage,
  menuMealRetryMessage,
} from '../../../common/constants';
import { MenuDayPlanSchema, MenuMealPlanSchema } from '../../../common/contracts';
import { ProfileContext, RecipeSnapshot, ResolvedDay } from '../../../common/types';
import { buildRecipeSnapshot, PROFILE_ID } from '../../../test/fixtures';
import { MenuComposer } from './menu-composer';
import { MenuPlanCandidates } from './menu-plan';
import {
  ReplacementInput,
  ReplacementModelCall,
  replaceParts,
  replacedSlots,
} from './menu-replacement';

const PREFIXES = ['b', 'l', 's', 'd'];
const profile: ProfileContext = {
  profileId: PROFILE_ID,
  goal: null,
  nutritionGoal: null,
  rules: { diets: [], allergies: [], excludedIngredients: [], dislikedFoods: [] },
};
/** Recipe `n` of every meal, `b1` to `d4`, 100 kcal a serving each. */
const recipe = (mealType: MealType, n: number): RecipeSnapshot =>
  buildRecipeSnapshot({
    id: `${PREFIXES[MENU_PLAN_MEAL_TYPES.indexOf(mealType)]}${n}`,
    name: `${mealType} ${n}`,
    mealType,
    perServing: { kcal: 100, proteinG: 0, fatG: 0, carbsG: 0 },
  });
const recipes = MENU_PLAN_MEAL_TYPES.flatMap((mealType) =>
  [1, 2, 3, 4].map((n) => recipe(mealType, n)),
);
/** A day of recipe `n` of every meal, one serving each. */
const savedDay = (dayIndex: number, n: number): ResolvedDay => ({
  dayIndex,
  date: new Date(`2026-11-0${dayIndex + 1}`),
  meals: MENU_PLAN_MEAL_TYPES.map((mealType) => {
    const snapshot = recipe(mealType, n);
    return { mealType, servings: 1, recipeId: snapshot.id, recipe: snapshot };
  }),
});
const previous = (): ResolvedDay[] => [savedDay(0, 1), savedDay(1, 2), savedDay(2, 3)];

/** The input; the candidates keep the ids of the recipes, so a plan names them. */
const input = (overrides: Partial<ReplacementInput> = {}): ReplacementInput => ({
  request: 'Change it',
  profile,
  previous: previous(),
  recipes,
  rejectedRecipeIds: new Set(),
  dailyKcal: null,
  label: (allowed) => ({
    candidates: Object.fromEntries(
      MENU_PLAN_MEAL_TYPES.map((mealType) => [
        mealType,
        allowed
          .filter((option) => option.mealType === mealType)
          .map(({ id, name, perServing, complete }) => ({ id, name, perServing, complete })),
      ]),
    ) as MenuPlanCandidates,
    recipeIds: new Map(recipes.map(({ id }) => [id, id])),
  }),
  compose: (days) => new MenuComposer().compose(days, profile),
  ...overrides,
});

/** A model that answers every call with the next of `answers`, recording the calls. */
const modelOf = (
  ...answers: unknown[]
): {
  ask: <T>(
    call: ReplacementModelCall<T>,
    problemsOf: (plan: T) => string[],
    retryMessage: (problems: string[]) => string,
  ) => Promise<T>;
  calls: Array<{ call: ReplacementModelCall<unknown>; retryMessage: unknown; problems: string[] }>;
} => {
  const calls: Array<{
    call: ReplacementModelCall<unknown>;
    retryMessage: unknown;
    problems: string[];
  }> = [];
  return {
    calls,
    ask: async <T>(
      call: ReplacementModelCall<T>,
      problemsOf: (plan: T) => string[],
      retryMessage: (problems: string[]) => string,
    ): Promise<T> => {
      const answer = answers[calls.length] as T;
      calls.push({
        call: call as ReplacementModelCall<unknown>,
        retryMessage,
        problems: problemsOf(answer),
      });
      return answer;
    },
  };
};
const dayPlan = (n: number, message = `Day of ${n}.`): unknown => ({
  message,
  meals: { breakfast: `b${n}`, lunch: `l${n}`, snack: `s${n}`, dinner: `d${n}` },
});
const sentRecipes = (call: ReplacementModelCall<unknown>): unknown =>
  JSON.parse(call.input[0].content as string).recipes;
const ids = (candidates: Array<{ id: string }>): string[] => candidates.map(({ id }) => id);

describe('replaceParts', () => {
  it('keeps the menu as it is without parts', async () => {
    const model = modelOf();

    await expect(replaceParts({ days: [], meals: [] }, input(), model.ask)).resolves.toEqual({
      days: previous(),
      messages: [],
      unknown: [],
    });
    expect(model.calls).toHaveLength(0);
  });

  it('plans the days, then the meals, each on the menu the parts before it made', async () => {
    const model = modelOf(dayPlan(4, 'New Monday.'), {
      message: 'New dinner.',
      recipe: 'd1',
    });

    const replaced = await replaceParts(
      { days: [0], meals: [{ dayIndex: 1, mealType: MealType.Dinner }] },
      input(),
      model.ask,
    );

    const [dayCall, mealCall] = model.calls;
    expect(dayCall.call.schema).toBe(MenuDayPlanSchema);
    expect(dayCall.call.options.prompt).toBe(MENU_DAY_PROMPT);
    expect(dayCall.retryMessage).toBe(menuDayRetryMessage);
    // Monday: without its own 1 and the recipes 2 and 3 of the other days.
    expect(ids((sentRecipes(dayCall.call) as MenuPlanCandidates).dinner)).toEqual(['d4']);
    expect(mealCall.call.schema).toBe(MenuMealPlanSchema);
    expect(mealCall.call.options.prompt).toBe(MENU_MEAL_PROMPT);
    expect(mealCall.retryMessage).toBe(menuMealRetryMessage);
    // Tuesday's dinner: not the old d2, nor d3 of Wednesday, nor d4 of the new Monday; d1 of the
    // old Monday, rejected, as no other is left.
    expect(ids(sentRecipes(mealCall.call) as Array<{ id: string }>)).toEqual(['d1']);
    expect(replaced.messages).toEqual(['New Monday.', 'New dinner.']);
    expect(replaced.unknown).toEqual([]);
    expect(replaced.days[0]).toMatchObject({
      dayIndex: 0,
      date: new Date('2026-11-01'),
      meals: MENU_PLAN_MEAL_TYPES.map((mealType) => ({ mealType, recipe: recipe(mealType, 4) })),
    });
    expect(replaced.days[1].meals.map(({ recipeId }) => recipeId)).toEqual([
      'b2',
      'l2',
      's2',
      'd1',
    ]);
    expect(replaced.days[1].meals[0]).toEqual(previous()[1].meals[0]);
    expect(replaced.days[2]).toEqual(previous()[2]);
  });

  it('leaves out the rejected recipes and those of the parts replaced before, while a meal has another', async () => {
    const model = modelOf(dayPlan(4), {}, {});
    const more = [...recipes, recipe(MealType.Breakfast, 5), recipe(MealType.Dinner, 5)];

    await replaceParts(
      {
        days: [0],
        meals: [
          { dayIndex: 1, mealType: MealType.Breakfast },
          { dayIndex: 2, mealType: MealType.Dinner },
        ],
      },
      input({ recipes: more, rejectedRecipeIds: new Set(['b5']) }),
      model.ask,
    );

    const [dayCall, breakfastCall] = model.calls;
    // Monday: b5 rejected before; d5 kept.
    expect(ids((sentRecipes(dayCall.call) as MenuPlanCandidates).breakfast)).toEqual(['b4']);
    expect(ids((sentRecipes(dayCall.call) as MenuPlanCandidates).dinner)).toEqual(['d4', 'd5']);
    // Tuesday's breakfast: b1 of the old Monday and b5 rejected, b4 in the menu: only the
    // rejected ones are left, so they stay.
    expect(ids(sentRecipes(breakfastCall.call) as Array<{ id: string }>)).toEqual(['b1', 'b5']);
  });

  it('checks every part against the menu with it in place', async () => {
    const model = modelOf(dayPlan(9), dayPlan(4));

    await replaceParts({ days: [0, 2], meals: [] }, input(), model.ask);

    expect(model.calls[0].problems).toEqual(
      MENU_PLAN_MEAL_TYPES.map(
        (mealType, i) =>
          `dayIndex 0, ${mealType}: "${PREFIXES[i]}9" is not an id from the ${mealType} recipes.`,
      ),
    );
  });

  it('stops at a part that is not a candidate, with the messages of the parts before it', async () => {
    const model = modelOf(dayPlan(4, 'New Monday.'), { message: 'Unknown.', recipe: 'd9' }, {});

    await expect(
      replaceParts(
        {
          days: [0],
          meals: [
            { dayIndex: 1, mealType: MealType.Dinner },
            { dayIndex: 2, mealType: MealType.Dinner },
          ],
        },
        input(),
        model.ask,
      ),
    ).resolves.toEqual({
      days: null,
      messages: ['New Monday.'],
      unknown: ['dayIndex 1, dinner: "d9" is not an id from the dinner recipes.'],
    });
    expect(model.calls).toHaveLength(2);
  });

  it('stops at a day that is not of candidates', async () => {
    const model = modelOf(dayPlan(9));

    const replaced = await replaceParts({ days: [0, 1], meals: [] }, input(), model.ask);

    expect(replaced.days).toBeNull();
    expect(replaced.unknown).toHaveLength(4);
    expect(model.calls).toHaveLength(1);
  });

  it('fits the servings of a day and of a meal to the daily calories', async () => {
    const model = modelOf(dayPlan(4), { message: 'New dinner.', recipe: 'd1' });

    const replaced = await replaceParts(
      { days: [0], meals: [{ dayIndex: 1, mealType: MealType.Dinner }] },
      input({ dailyKcal: 600 }),
      model.ask,
    );

    expect(replaced.days[0].meals.map(({ servings }) => servings)).toEqual([1.5, 1.5, 1.5, 1.5]);
    // 300 kcal of the other meals: 3 servings would be closest, 2 is the most a meal has.
    expect(replaced.days[1].meals.map(({ servings }) => servings)).toEqual([1, 1, 1, 2]);
  });

  it('rejects a day or a meal the menu does not have', async () => {
    await expect(replaceParts({ days: [5], meals: [] }, input(), modelOf().ask)).rejects.toThrow(
      'The menu has no day 5',
    );
    const menu = previous();
    menu[1].meals = menu[1].meals.slice(0, 3);
    await expect(
      replaceParts(
        { days: [], meals: [{ dayIndex: 1, mealType: MealType.Dinner }] },
        input({ previous: menu }),
        modelOf().ask,
      ),
    ).rejects.toThrow('The menu has no dinner on day 1');
  });
});

describe('replacedSlots', () => {
  it('lists every meal of the days and the meals replaced, in the order of the menu', () => {
    expect(
      replacedSlots({ days: [2], meals: [{ dayIndex: 0, mealType: MealType.Lunch }] }, previous()),
    ).toEqual([
      { dayIndex: 0, mealType: MealType.Lunch },
      ...MENU_PLAN_MEAL_TYPES.map((mealType) => ({ dayIndex: 2, mealType })),
    ]);
  });
});
