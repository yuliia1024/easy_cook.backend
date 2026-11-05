import {
  INTENT_REQUEST_ITEM_MAX_LENGTH,
  INTENT_REQUEST_MAX_LENGTH,
  SUMMARY_MAX_LENGTH,
} from '../constants';
import {
  IntentResultSchema,
  MenuDayPlanSchema,
  MenuMealPlanSchema,
  MenuPlanSchema,
  MenuRequestSchema,
  MenuTargetSchema,
  SummaryResultSchema,
} from './chat';

describe('chat contracts', () => {
  const menuRequest = {
    days: 3,
    mealTypes: ['breakfast', 'dinner'],
    caloriesKcal: 1800,
    diets: ['vegetarian'],
    excludedIngredients: ['fish'],
    dislikedFoods: ['mushrooms'],
  };

  describe('IntentResultSchema', () => {
    const result = (overrides: object): unknown => ({
      intent: 'general_chat',
      request: null,
      menuRequest: null,
      targets: null,
      ...overrides,
    });

    it('accepts only the known intents with a request up to the limit or null', () => {
      expect(IntentResultSchema.safeParse(result({})).success).toBe(true);
      expect(
        IntentResultSchema.safeParse(
          result({ intent: 'generate_menu', request: 'a'.repeat(INTENT_REQUEST_MAX_LENGTH) }),
        ).success,
      ).toBe(true);
      expect(
        IntentResultSchema.safeParse(
          result({ intent: 'generate_menu', request: 'a'.repeat(INTENT_REQUEST_MAX_LENGTH + 1) }),
        ).success,
      ).toBe(false);
      expect(IntentResultSchema.safeParse(result({ intent: 'delete_everything' })).success).toBe(
        false,
      );
      expect(IntentResultSchema.safeParse({ intent: 'general_chat', request: null }).success).toBe(
        false,
      );
      expect(IntentResultSchema.safeParse({}).success).toBe(false);
    });

    it('accepts a menu revision with the request as fields and its targets', () => {
      expect(
        IntentResultSchema.safeParse(
          result({
            intent: 'revise_menu',
            request: 'Plan a 3-day menu with another lunch and Tuesday',
            menuRequest,
            targets: [
              { scope: 'meal', dayIndex: null, mealType: 'lunch' },
              { scope: 'day', dayIndex: 1, mealType: null },
            ],
          }),
        ).success,
      ).toBe(true);
    });

    it('rejects targets that are not a list', () => {
      expect(
        IntentResultSchema.safeParse(
          result({ targets: { scope: 'day', dayIndex: 1, mealType: null } }),
        ).success,
      ).toBe(false);
    });
  });

  describe('MenuRequestSchema', () => {
    it('accepts a request with nothing given', () => {
      expect(
        MenuRequestSchema.safeParse({
          days: null,
          mealTypes: [],
          caloriesKcal: null,
          diets: [],
          excludedIngredients: [],
          dislikedFoods: [],
        }).success,
      ).toBe(true);
    });

    it.each([365, 0, -2])('leaves the limits of days to the backend: %i', (days) => {
      expect(MenuRequestSchema.safeParse({ ...menuRequest, days }).success).toBe(true);
    });

    it.each([
      ['fractional days', { days: 1.5 }],
      ['an unknown meal', { mealTypes: ['brunch'] }],
      ['an unknown diet', { diets: ['keto'] }],
      ['zero kcal', { caloriesKcal: 0 }],
      ['an empty ingredient', { excludedIngredients: [''] }],
      ['a too long food', { dislikedFoods: ['a'.repeat(INTENT_REQUEST_ITEM_MAX_LENGTH + 1)] }],
      ['a missing field', { dislikedFoods: undefined }],
    ])('rejects %s', (_name, overrides) => {
      expect(MenuRequestSchema.safeParse({ ...menuRequest, ...overrides }).success).toBe(false);
    });
  });

  describe('MenuTargetSchema', () => {
    it.each([
      { scope: 'menu', dayIndex: null, mealType: null },
      { scope: 'day', dayIndex: 1, mealType: null },
      { scope: 'meal', dayIndex: null, mealType: 'dinner' },
    ])('accepts %j', (target) => {
      expect(MenuTargetSchema.safeParse(target).success).toBe(true);
    });

    it.each([
      { scope: 'week', dayIndex: null, mealType: null },
      { scope: 'day', dayIndex: -1, mealType: null },
      { scope: 'meal', dayIndex: 0, mealType: 'brunch' },
      { scope: 'menu', dayIndex: null },
    ])('rejects %j', (target) => {
      expect(MenuTargetSchema.safeParse(target).success).toBe(false);
    });
  });

  describe('MenuPlanSchema', () => {
    const meals = { breakfast: 'b1', lunch: 'l1', dinner: 'd1', snack: 's1' };

    it('accepts a message and the meals of every day, leaving the days to the planner', () => {
      expect(
        MenuPlanSchema.safeParse({
          message: 'Two days.',
          days: [
            { dayIndex: 1, meals },
            { dayIndex: 1, meals },
          ],
        }).success,
      ).toBe(true);
    });

    it.each([
      { message: 'x', breakfast: 'b1', lunch: 'l1', dinner: 'd1' },
      { message: 'x', days: [{ dayIndex: 0.5, meals }] },
      { message: 'x', days: [{ dayIndex: 0, meals: { breakfast: 'b1', lunch: 'l1' } }] },
    ])('rejects %j', (plan) => {
      expect(MenuPlanSchema.safeParse(plan).success).toBe(false);
    });
  });

  describe('MenuDayPlanSchema', () => {
    const meals = { breakfast: 'b1', lunch: 'l1', snack: 's1', dinner: 'd1' };

    it('accepts a message and a recipe id for every meal of the day', () => {
      expect(MenuDayPlanSchema.safeParse({ message: 'New day.', meals }).success).toBe(true);
    });

    it('rejects a day without a meal', () => {
      const { snack: _snack, ...withoutSnack } = meals;

      expect(
        MenuDayPlanSchema.safeParse({ message: 'New day.', meals: withoutSnack }).success,
      ).toBe(false);
    });
  });

  describe('MenuMealPlanSchema', () => {
    it('accepts a message and one recipe id', () => {
      expect(MenuMealPlanSchema.safeParse({ message: 'New dinner.', recipe: 'd2' }).success).toBe(
        true,
      );
    });

    it('rejects a meal without a recipe', () => {
      expect(MenuMealPlanSchema.safeParse({ message: 'New dinner.' }).success).toBe(false);
    });
  });

  describe('SummaryResultSchema', () => {
    it('accepts a summary that is not empty and within the limit', () => {
      expect(SummaryResultSchema.safeParse({ summary: 'Rejected the salmon.' }).success).toBe(true);
      expect(
        SummaryResultSchema.safeParse({ summary: 'a'.repeat(SUMMARY_MAX_LENGTH) }).success,
      ).toBe(true);
      expect(
        SummaryResultSchema.safeParse({ summary: 'a'.repeat(SUMMARY_MAX_LENGTH + 1) }).success,
      ).toBe(false);
      expect(SummaryResultSchema.safeParse({ summary: '' }).success).toBe(false);
      expect(SummaryResultSchema.safeParse({}).success).toBe(false);
    });
  });
});
