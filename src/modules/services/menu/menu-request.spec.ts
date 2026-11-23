import {
  CalculationMode,
  CLARIFICATION_REPLY,
  DietTag,
  Goal,
  Intent,
  MealType,
} from '../../../common/constants';
import { IntentResult, MenuRequest } from '../../../common/contracts';
import { ProfileContext } from '../../../common/types';
import { PROFILE_ID } from '../../../test/fixtures';
import {
  describeMenuRequest,
  EMPTY_MENU_REQUEST,
  menuClarification,
  requestRules,
  resolveClarification,
  resolveMenuRequest,
  ResolvedMenuRequest,
} from './menu-request';

describe('resolveMenuRequest', () => {
  const profile: ProfileContext = {
    profileId: PROFILE_ID,
    goal: Goal.Maintain,
    nutritionGoal: {
      goalId: 'goal',
      caloriesKcal: 2000,
      proteinG: 100,
      fatG: 60,
      carbsG: 250,
      calculationMode: CalculationMode.Manual,
      ruleVersion: null,
    },
    rules: {
      diets: [DietTag.Vegetarian, 'unknown diet'],
      allergies: ['peanut'],
      excludedIngredients: ['pork'],
      dislikedFoods: ['olives'],
    },
  };
  const request = (overrides: Partial<MenuRequest>): MenuRequest => ({
    ...EMPTY_MENU_REQUEST,
    ...overrides,
  });

  it('takes the calorie goal and the preferences from the profile, not days or meals', () => {
    expect(resolveMenuRequest(profile, null, null)).toEqual({
      chat: EMPTY_MENU_REQUEST,
      request: {
        days: null,
        mealTypes: [],
        caloriesKcal: 2000,
        diets: [DietTag.Vegetarian],
        excludedIngredients: ['pork'],
        dislikedFoods: ['olives'],
        wishes: null,
      },
      missingFields: ['days', 'mealTypes'],
      daysOutOfRange: null,
    });
  });

  it('lets the chat win over the profile and the message over the chat', () => {
    const chat = request({ days: 3, caloriesKcal: 1800, diets: [DietTag.Vegan] });
    const message = request({ days: 5, mealTypes: [MealType.Dinner] });

    const resolved = resolveMenuRequest(profile, chat, message);

    expect(resolved.chat).toEqual(
      request({
        days: 5,
        mealTypes: [MealType.Dinner],
        caloriesKcal: 1800,
        diets: [DietTag.Vegan],
      }),
    );
    expect(resolved.request).toEqual({
      days: 5,
      mealTypes: [MealType.Dinner],
      caloriesKcal: 1800,
      diets: [DietTag.Vegan],
      excludedIngredients: ['pork'],
      dislikedFoods: ['olives'],
      wishes: null,
    });
    expect(resolved.missingFields).toEqual([]);
  });

  it('never clears an earlier value with null or an empty list', () => {
    const chat = request({
      days: 3,
      mealTypes: [MealType.Lunch],
      caloriesKcal: 1500,
      excludedIngredients: ['mushrooms'],
    });

    const resolved = resolveMenuRequest(profile, chat, EMPTY_MENU_REQUEST);

    expect(resolved.chat).toEqual(chat);
    expect(resolved.request).toMatchObject({
      days: 3,
      mealTypes: [MealType.Lunch],
      caloriesKcal: 1500,
      excludedIngredients: ['mushrooms'],
      dislikedFoods: ['olives'],
      wishes: null,
    });
  });

  it('keeps the wishes of the chat until a message gives others', () => {
    const chat = request({ days: 3, wishes: 'more fish' });

    expect(resolveMenuRequest(null, chat, request({ days: 5 })).request.wishes).toBe('more fish');
    expect(resolveMenuRequest(null, chat, request({ wishes: 'soups' })).chat.wishes).toBe('soups');
  });

  it('keeps the chat out of the profile it is resolved with', () => {
    expect(resolveMenuRequest(profile, null, request({ days: 2 })).chat).toEqual(
      request({ days: 2 }),
    );
  });

  it('works without a profile, a chat request or a message request', () => {
    expect(resolveMenuRequest(null, null, null)).toEqual({
      chat: EMPTY_MENU_REQUEST,
      request: EMPTY_MENU_REQUEST,
      missingFields: ['days', 'mealTypes'],
      daysOutOfRange: null,
    });
  });

  it('reports only the required fields nobody gave', () => {
    expect(resolveMenuRequest(profile, request({ days: 2 }), null).missingFields).toEqual([
      'mealTypes',
    ]);
  });

  it.each([
    [10, 7],
    [8, 7],
    [0, 1],
    [-3, 1],
  ])('offers %i days as %i instead of cutting them silently', (requested, offered) => {
    const resolved = resolveMenuRequest(
      profile,
      request({ days: 3 }),
      request({ days: requested, mealTypes: [MealType.Breakfast] }),
    );

    expect(resolved.daysOutOfRange).toEqual({ requested, offered });
    expect(resolved.chat.days).toBe(offered);
    expect(resolved.request.days).toBe(offered);
  });

  it('adds the constraints of a revision to those of the chat and keeps the other fields', () => {
    const chat = request({
      days: 3,
      mealTypes: [MealType.Lunch],
      diets: [DietTag.Vegetarian],
      excludedIngredients: ['mushrooms'],
      dislikedFoods: ['olives'],
      wishes: null,
    });

    const resolved = resolveMenuRequest(
      profile,
      chat,
      request({
        mealTypes: [MealType.Dinner],
        diets: [DietTag.GlutenFree],
        excludedIngredients: ['chicken', 'mushrooms'],
      }),
      { revision: true },
    );

    expect(resolved.chat).toEqual({
      ...chat,
      mealTypes: [MealType.Dinner],
      diets: [DietTag.Vegetarian, DietTag.GlutenFree],
      excludedIngredients: ['mushrooms', 'chicken'],
    });
  });

  it('replaces the constraint lists of the chat with those of a new request', () => {
    const resolved = resolveMenuRequest(
      null,
      request({ excludedIngredients: ['mushrooms'] }),
      request({ excludedIngredients: ['chicken'] }),
    );

    expect(resolved.chat.excludedIngredients).toEqual(['chicken']);
  });

  it.each([1, 7])('accepts %i days', (days) => {
    const resolved = resolveMenuRequest(null, null, request({ days }));

    expect(resolved.daysOutOfRange).toBeNull();
    expect(resolved.chat.days).toBe(days);
  });
});

describe('requestRules', () => {
  it('adds the constraints of the request to the rules, without duplicates', () => {
    expect(
      requestRules(
        {
          diets: [DietTag.Vegetarian],
          allergies: ['peanut'],
          excludedIngredients: ['pork'],
          dislikedFoods: ['olives'],
        },
        {
          ...EMPTY_MENU_REQUEST,
          diets: [DietTag.Vegetarian, DietTag.GlutenFree],
          excludedIngredients: ['chicken'],
          dislikedFoods: ['olives', 'onion'],
        },
      ),
    ).toEqual({
      diets: [DietTag.Vegetarian, DietTag.GlutenFree],
      allergies: ['peanut'],
      excludedIngredients: ['pork', 'chicken'],
      dislikedFoods: ['olives', 'onion'],
    });
  });

  it('keeps the rules for a request without constraints', () => {
    const rules = { diets: [], allergies: [], excludedIngredients: ['pork'], dislikedFoods: [] };

    expect(requestRules(rules, EMPTY_MENU_REQUEST)).toEqual(rules);
  });
});

describe('describeMenuRequest', () => {
  it('restates every field that is set', () => {
    expect(
      describeMenuRequest({
        days: 3,
        mealTypes: [MealType.Breakfast, MealType.Dinner],
        caloriesKcal: 1800,
        diets: [DietTag.GlutenFree],
        excludedIngredients: ['mushrooms'],
        dislikedFoods: ['olives', 'tofu'],
        wishes: 'more fish',
      }),
    ).toBe(
      'Plan a 3-day menu with breakfast, dinner of about 1800 kcal a day that is gluten free without mushrooms avoiding olives, tofu with more fish.',
    );
  });

  it('leaves out what is not set', () => {
    expect(describeMenuRequest(EMPTY_MENU_REQUEST)).toBe('Plan a menu.');
  });
});

describe('resolveClarification', () => {
  const clarification: IntentResult = {
    intent: Intent.Clarification,
    request: null,
    menuRequest: null,
    targets: null,
  };
  const gathered = { ...EMPTY_MENU_REQUEST, days: 3, mealTypes: [MealType.Dinner] };

  it('turns a clarification the chat answers into a menu request with the gathered request', () => {
    expect(resolveClarification(clarification, resolveMenuRequest(null, gathered, null))).toEqual({
      intent: Intent.GenerateMenu,
      request: 'Plan a 3-day menu with dinner.',
      menuRequest: gathered,
      targets: null,
    });
  });

  it('keeps a clarification while a required field is missing', () => {
    const resolved = resolveMenuRequest(null, { ...gathered, mealTypes: [] }, null);

    expect(resolveClarification(clarification, resolved)).toBe(clarification);
  });

  it.each([Intent.GeneralChat, Intent.GenerateMenu, Intent.ReviseMenu])(
    'returns %s as it is',
    (intent) => {
      const result = { ...clarification, intent };

      expect(resolveClarification(result, resolveMenuRequest(null, gathered, null))).toBe(result);
    },
  );
});

describe('menuClarification', () => {
  const resolved = (overrides: Partial<ResolvedMenuRequest> = {}): ResolvedMenuRequest => ({
    chat: EMPTY_MENU_REQUEST,
    request: EMPTY_MENU_REQUEST,
    missingFields: ['mealTypes'],
    daysOutOfRange: null,
    ...overrides,
  });

  it('asks a clarification for the missing fields', () => {
    expect(menuClarification(Intent.Clarification, resolved())).toEqual({
      message: CLARIFICATION_REPLY,
      missingFields: ['mealTypes'],
    });
  });

  it.each([Intent.GenerateMenu, Intent.ReviseMenu])(
    'offers the nearest days for a %s request out of range',
    (intent) => {
      expect(
        menuClarification(intent, resolved({ daysOutOfRange: { requested: 10, offered: 7 } })),
      ).toEqual({
        message: 'I can plan a menu for up to 7 days, not 10. Shall I make a 7-day menu?',
        missingFields: ['days'],
      });
    },
  );

  it.each([Intent.GenerateMenu, Intent.GeneralChat, Intent.OutOfScope])(
    'asks nothing for %s otherwise',
    (intent) => {
      expect(menuClarification(intent, resolved())).toBeNull();
    },
  );

  it('asks nothing for a chat out of range of days', () => {
    expect(
      menuClarification(
        Intent.GeneralChat,
        resolved({ daysOutOfRange: { requested: 10, offered: 7 } }),
      ),
    ).toBeNull();
  });
});
