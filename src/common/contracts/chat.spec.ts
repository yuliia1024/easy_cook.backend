import { INTENT_REQUEST_ITEM_MAX_LENGTH, INTENT_REQUEST_MAX_LENGTH } from '../constants';
import { IntentResultSchema, MenuRequestSchema, MenuTargetSchema } from './chat';

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
      target: null,
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

    it('accepts a menu revision with the request as fields and its target', () => {
      expect(
        IntentResultSchema.safeParse(
          result({
            intent: 'revise_menu',
            request: 'Plan a 3-day menu with another lunch',
            menuRequest,
            target: { scope: 'meal', dayIndex: null, mealType: 'lunch' },
          }),
        ).success,
      ).toBe(true);
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

    it('leaves the upper limit of days to the backend', () => {
      expect(MenuRequestSchema.safeParse({ ...menuRequest, days: 365 }).success).toBe(true);
    });

    it.each([
      ['zero days', { days: 0 }],
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
});
