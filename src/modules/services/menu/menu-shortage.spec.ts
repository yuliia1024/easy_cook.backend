import { DietTag, MealType, MenuConstraintKind } from '../../../common/constants';
import { PreferenceRules } from '../../../common/types';
import { buildFoodItem, buildIngredient, buildRecipe } from '../../../test/fixtures';
import {
  findMenuShortage,
  hasEnoughRecipes,
  MenuShortage,
  menuMinRecipes,
  menuShortageReply,
} from './menu-shortage';

const NO_RULES: PreferenceRules = {
  diets: [],
  allergies: [],
  excludedIngredients: [],
  dislikedFoods: [],
};

const recipe = (mealType: MealType, dietType: string[], foodName = 'Rice, boiled') =>
  buildRecipe({
    mealType,
    dietType,
    ingredients: [buildIngredient({ foodItem: buildFoodItem({ name: foodName, nameEn: null }) })],
  });
const times = <T>(count: number, make: () => T): T[] => Array.from({ length: count }, make);

describe('menu shortage', () => {
  describe('menuMinRecipes', () => {
    it.each([
      [1, 1],
      [2, 2],
      [3, 2],
      [4, 2],
      [5, 3],
      [7, 4],
    ])('%i day(s) need %i recipes for every meal', (days, recipes) => {
      expect(menuMinRecipes(days)).toBe(recipes);
    });
  });

  describe('hasEnoughRecipes', () => {
    const oneOfEach = [MealType.Breakfast, MealType.Lunch, MealType.Snack, MealType.Dinner].map(
      (mealType) => ({ mealType }),
    );

    it('is true when every meal has enough recipes for the days', () => {
      expect(hasEnoughRecipes(oneOfEach, 1)).toBe(true);
      expect(hasEnoughRecipes([...oneOfEach, ...oneOfEach], 4)).toBe(true);
    });

    it('is false when a meal has too few or none', () => {
      expect(hasEnoughRecipes(oneOfEach, 2)).toBe(false);
      expect(hasEnoughRecipes(oneOfEach.slice(1), 1)).toBe(false);
    });
  });

  describe('findMenuShortage', () => {
    /** 4 vegan recipes of each meal, 2 of the lunches and dinners with chickpeas; 6 lunches and dinners with chicken. */
    const recipes = [
      ...times(4, () => recipe(MealType.Breakfast, [DietTag.Vegan])),
      ...times(4, () => recipe(MealType.Snack, [DietTag.Vegan])),
      ...times(2, () => recipe(MealType.Lunch, [DietTag.Vegan])),
      ...times(2, () => recipe(MealType.Lunch, [DietTag.Vegan], 'Chickpeas, boiled')),
      ...times(1, () => recipe(MealType.Dinner, [DietTag.Vegan])),
      ...times(3, () => recipe(MealType.Dinner, [DietTag.Vegan], 'Chickpeas, boiled')),
      ...times(6, () => recipe(MealType.Lunch, [], 'Chicken breast')),
      ...times(6, () => recipe(MealType.Dinner, [], 'Chicken breast')),
    ];
    const veganNoChickpeas: PreferenceRules = {
      ...NO_RULES,
      diets: [DietTag.Vegan],
      excludedIngredients: ['chickpeas'],
    };
    const profileRules: PreferenceRules = { ...NO_RULES, diets: [DietTag.Vegan] };

    it('is null when the recipes are enough', () => {
      expect(findMenuShortage(recipes, veganNoChickpeas, profileRules, 1)).toBeNull();
    });

    it('names the short meals, the limiting rules, the ways out and the most days', () => {
      expect(findMenuShortage(recipes, veganNoChickpeas, profileRules, 7)).toEqual({
        days: 7,
        required: 4,
        shortMeals: [
          { mealType: MealType.Lunch, count: 2 },
          { mealType: MealType.Dinner, count: 1 },
        ],
        limiting: [
          { kind: MenuConstraintKind.Diet, value: DietTag.Vegan, fromProfile: true },
          {
            kind: MenuConstraintKind.ExcludedIngredient,
            value: 'chickpeas',
            fromProfile: false,
          },
        ],
        options: [
          [{ kind: MenuConstraintKind.Diet, value: DietTag.Vegan, fromProfile: true }],
          [
            {
              kind: MenuConstraintKind.ExcludedIngredient,
              value: 'chickpeas',
              fromProfile: false,
            },
          ],
        ],
        maxDays: 1,
      } satisfies MenuShortage);
    });

    it('names rules that leave too few only together and offers to drop both', () => {
      const shortage = findMenuShortage(
        [
          ...times(2, () => recipe(MealType.Breakfast, [DietTag.Vegan, DietTag.LowCarb])),
          ...times(2, () => recipe(MealType.Snack, [DietTag.Vegan, DietTag.LowCarb])),
          ...times(2, () => recipe(MealType.Dinner, [DietTag.Vegan, DietTag.LowCarb])),
          ...times(2, () => recipe(MealType.Lunch, [DietTag.Vegan], 'Chickpeas, boiled')),
        ],
        { ...veganNoChickpeas, diets: [DietTag.Vegan, DietTag.LowCarb] },
        NO_RULES,
        2,
      );

      const lowCarb = { kind: MenuConstraintKind.Diet, value: DietTag.LowCarb, fromProfile: false };
      const chickpeas = {
        kind: MenuConstraintKind.ExcludedIngredient,
        value: 'chickpeas',
        fromProfile: false,
      };
      expect(shortage).toEqual({
        days: 2,
        required: 2,
        shortMeals: [{ mealType: MealType.Lunch, count: 0 }],
        limiting: [lowCarb, chickpeas],
        options: [[lowCarb, chickpeas]],
        maxDays: null,
      });
    });

    it('names an allergy that leaves too few but never offers to drop it', () => {
      const shortage = findMenuShortage(
        recipes,
        { ...NO_RULES, diets: [DietTag.Vegan], allergies: ['chickpeas'] },
        { ...NO_RULES, allergies: ['chickpeas'] },
        7,
      );

      expect(shortage?.limiting).toEqual([
        { kind: MenuConstraintKind.Diet, value: DietTag.Vegan, fromProfile: false },
        { kind: MenuConstraintKind.Allergy, value: 'chickpeas', fromProfile: true },
      ]);
      expect(shortage?.options).toEqual([
        [{ kind: MenuConstraintKind.Diet, value: DietTag.Vegan, fromProfile: false }],
      ]);
    });

    it('names no rule when the recipe book itself has too few', () => {
      const shortage = findMenuShortage(recipes, NO_RULES, NO_RULES, 1);
      expect(shortage).toBeNull();

      const noSnacks = recipes.filter(({ mealType }) => mealType !== MealType.Snack);
      expect(findMenuShortage(noSnacks, profileRules, profileRules, 1)).toMatchObject({
        shortMeals: [{ mealType: MealType.Snack, count: 0 }],
        limiting: [],
        options: [],
        maxDays: null,
      });
    });
  });

  describe('menuShortageReply', () => {
    const vegan = { kind: MenuConstraintKind.Diet, value: DietTag.Vegan, fromProfile: true };
    const legumes = {
      kind: MenuConstraintKind.ExcludedIngredient,
      value: 'legumes',
      fromProfile: false,
    };

    it('names the rules, the meals and every way out', () => {
      expect(
        menuShortageReply({
          days: 7,
          required: 4,
          shortMeals: [
            { mealType: MealType.Lunch, count: 2 },
            { mealType: MealType.Dinner, count: 1 },
          ],
          limiting: [vegan, legumes],
          options: [[vegan], [legumes]],
          maxDays: 1,
        }),
      ).toBe(
        "I can't plan a good 7-day menu: the vegan diet and excluding legumes leave 2 lunches and 1 dinner, and it needs at least 4 different recipes for every meal. To get a good menu, you could remove the vegan diet from your profile, allow legumes or plan 1 day instead of 7. Which would you like?",
      );
    });

    it('words the rules of the chat, of the profile and an allergy', () => {
      expect(
        menuShortageReply({
          days: 3,
          required: 2,
          shortMeals: [{ mealType: MealType.Snack, count: 0 }],
          limiting: [
            { kind: MenuConstraintKind.Diet, value: DietTag.LowCarb, fromProfile: false },
            { ...legumes, fromProfile: true },
            { kind: MenuConstraintKind.Allergy, value: 'peanut', fromProfile: true },
          ],
          options: [
            [
              { kind: MenuConstraintKind.Diet, value: DietTag.LowCarb, fromProfile: false },
              { ...legumes, fromProfile: true },
            ],
          ],
          maxDays: 2,
        }),
      ).toBe(
        "I can't plan a good 3-day menu: the low carb diet, excluding legumes and the peanut allergy leave no snacks, and it needs at least 2 different recipes for every meal. To get a good menu, you could drop the low carb diet and allow legumes in your profile or plan 2 days instead of 3. Which would you like?",
      );
    });

    it('asks for a different request, never for more recipes, when there is no way out', () => {
      expect(
        menuShortageReply({
          days: 1,
          required: 1,
          shortMeals: [
            { mealType: MealType.Breakfast, count: 0 },
            { mealType: MealType.Snack, count: 0 },
          ],
          limiting: [],
          options: [],
          maxDays: null,
        }),
      ).toBe(
        "I can't plan a good 1-day menu: the recipe book has no breakfasts and no snacks, and it needs at least 1 recipe for every meal. Please try a different request.",
      );
    });
  });
});
