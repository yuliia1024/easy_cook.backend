import { Prisma } from '../../src/generated/prisma/client';
import { buildFoodItem } from '../../src/test/fixtures';
import { checkRecipeRules, RuleIngredient, RuleRecipe } from './recipe-rules';

describe('recipe rules', () => {
  /** 365 / 7.1 / 0.7 / 80 per 100 g. */
  const rice = buildFoodItem({
    name: 'Rice',
    kcalPer100g: new Prisma.Decimal(365),
    proteinG: new Prisma.Decimal(7.1),
    fatG: new Prisma.Decimal(0.7),
    carbsG: new Prisma.Decimal(80),
  });
  const ingredient = (patch: Partial<RuleIngredient> = {}): RuleIngredient => ({
    label: 'rice',
    quantityG: 150,
    isOptional: false,
    foodItem: rice,
    ...patch,
  });
  const recipe = (patch: Partial<RuleRecipe> = {}): RuleRecipe => ({
    instructions: 'Boil',
    servings: 2,
    ingredients: [ingredient()],
    ...patch,
  });

  it('accepts a recipe that keeps every rule', () => {
    expect(checkRecipeRules(recipe())).toEqual({ reasons: [], warnings: [] });
  });

  it.each([null, undefined, '', '  \n'])('rejects instructions %p', (instructions) => {
    expect(checkRecipeRules(recipe({ instructions })).reasons).toEqual(['no instructions']);
  });

  it('rejects unmatched ingredients and skips the nutrition rules then', () => {
    const ingredients = [
      ingredient(),
      ingredient({ label: 'usda_fdc:1', foodItem: null }),
      ingredient({ label: 'saffron', foodItem: null, isOptional: true }),
    ];

    expect(checkRecipeRules(recipe({ ingredients, servings: 100 }))).toEqual({
      reasons: ['ingredients not matched to a food: usda_fdc:1, saffron'],
      warnings: [],
    });
  });

  it('rejects unknown nutrients of a counted ingredient, warns about an optional one', () => {
    const ingredients = [
      ingredient({ foodItem: { ...rice, fatG: null, carbsG: null } }),
      ingredient({
        label: 'herbs',
        quantityG: 5,
        isOptional: true,
        foodItem: { ...rice, kcalPer100g: null },
      }),
    ];

    expect(checkRecipeRules(recipe({ ingredients }))).toEqual({
      reasons: ['rice has no fatG, carbsG'],
      warnings: ['herbs has no kcal'],
    });
  });

  it.each([
    [10, 2, '18.3 kcal per serving, outside 50-2500'],
    [1400, 2, '2555 kcal per serving, outside 50-2500'],
  ])('rejects %p g in %p servings', (quantityG, servings, reason) => {
    const result = checkRecipeRules(recipe({ servings, ingredients: [ingredient({ quantityG })] }));

    expect(result.reasons).toEqual([reason]);
  });

  it.each([
    [27.4, 2],
    [684.9, 1],
  ])('accepts the limits (%p g in %p servings)', (quantityG, servings) => {
    const result = checkRecipeRules(recipe({ servings, ingredients: [ingredient({ quantityG })] }));

    expect(result.reasons).toEqual([]);
  });

  it('counts the calories without the optional ingredients', () => {
    const ingredients = [
      ingredient({ quantityG: 10 }),
      ingredient({ label: 'more rice', quantityG: 500, isOptional: true }),
    ];

    expect(checkRecipeRules(recipe({ servings: 1, ingredients })).reasons).toEqual([
      '36.5 kcal per serving, outside 50-2500',
    ]);
  });
});
