import {
  convertIngredients,
  FoodPortion,
  formatUnresolvedReport,
  isContainerUnit,
  parsePortionUnit,
  resolveUnit,
  toGrams,
} from './units';

describe('unit conversion', () => {
  describe('resolveUnit', () => {
    it.each([
      ['cup', { unit: 'cup' }],
      ['c.', { unit: 'cup' }],
      ['Cups', { unit: 'cup' }],
      ['T', { unit: 'tbsp' }],
      ['t', { unit: 'tsp' }],
      ['Tbsp.', { unit: 'tbsp' }],
      ['tsp.', { unit: 'tsp' }],
      ['fl oz', { unit: 'fl oz' }],
      ['lbs.', { unit: 'lb' }],
      ['шт', { unit: 'piece' }],
      ['pinch', { unit: 'pinch' }],
      ['cloves', { unit: 'clove' }],
      ['large', { unit: 'piece', size: 'large' }],
      ['', { unit: 'piece' }],
      [null, { unit: 'piece' }],
    ])('%p -> %p', (raw, expected) => {
      expect(resolveUnit(raw)).toEqual(expected);
    });

    it('returns null for an unknown word', () => {
      expect(resolveUnit('smidgen')).toBeNull();
    });
  });

  it('recognises containers', () => {
    expect(isContainerUnit('can')).toBe(true);
    expect(isContainerUnit('Pkg.')).toBe(true);
    expect(isContainerUnit('cup')).toBe(false);
  });

  describe('parsePortionUnit', () => {
    it.each([
      ['cup, chopped', { unit: 'cup' }],
      ['1 cup (8 fl oz)', { unit: 'cup' }],
      ['tbsp', { unit: 'tbsp' }],
      ['large', { unit: 'piece', size: 'large' }],
      ['medium (2-1/2" dia)', { unit: 'piece', size: 'medium' }],
      ['stalk, large (11"-12" long)', { unit: 'stalk', size: 'large' }],
      ['clove', { unit: 'clove' }],
      ['pepper, small (2-1/4" long)', { unit: 'piece', size: 'small' }],
      ['fruit without skin and seed', { unit: 'piece' }],
    ])('%s -> %p', (description, expected) => {
      expect(parsePortionUnit(description)).toEqual(expected);
    });

    it.each(['oz', 'Quantity not specified', 'serving'])('skips "%s"', (description) => {
      expect(parsePortionUnit(description)).toBeNull();
    });
  });

  describe('toGrams', () => {
    it('converts mass units exactly', () => {
      expect(toGrams({ food: 'beef', amount: 1, unit: 'lb' })).toEqual({
        grams: 453.59,
        method: 'mass',
      });
      expect(toGrams({ food: 'cheese', amount: 8, unit: 'oz.' })).toEqual({
        grams: 226.8,
        method: 'mass',
      });
      expect(toGrams({ food: 'rice', amount: 0.5, unit: 'kg' })).toEqual({
        grams: 500,
        method: 'mass',
      });
    });

    it('prefers the USDA portion of the same unit', () => {
      const portions: FoodPortion[] = [{ unit: 'cup', grams: 160 }];

      expect(toGrams({ food: 'onion', amount: 0.5, unit: 'cup' }, portions)).toEqual({
        grams: 80,
        method: 'portion',
      });
    });

    it('derives other volume units from a USDA portion', () => {
      const portions: FoodPortion[] = [{ unit: 'cup', grams: 200 }];

      expect(toGrams({ food: 'sugar', amount: 1, unit: 'tbsp' }, portions)).toEqual({
        grams: 12.5,
        method: 'portion',
      });
    });

    it.each([
      [{ food: 'all-purpose flour', amount: 1, unit: 'cup' }, 125.39],
      [{ food: 'brown sugar', amount: 1, unit: 'c.' }, 220.03],
      [{ food: 'Sugars, granulated', amount: 1, unit: 'cup' }, 201.1],
      [{ food: 'peanut butter', amount: 2, unit: 'T' }, 31.94],
      [{ food: 'butter', amount: 2, unit: 'Tbsp.' }, 28.39],
      [{ food: 'salt', amount: 1, unit: 't' }, 6.01],
      [{ food: 'salt', amount: 1, unit: 'pinch' }, 0.38],
      [{ food: 'milk', amount: 1, unit: 'cup' }, 243.69],
      [{ food: 'olive oil', amount: 1, unit: 'tbsp' }, 13.6],
    ])('uses the density table: %p -> %p g', (ingredient, grams) => {
      expect(toGrams(ingredient)).toEqual({ grams, method: 'density' });
    });

    it('converts counts with a USDA portion of that size', () => {
      const portions: FoodPortion[] = [
        { unit: 'piece', size: 'large', grams: 50 },
        { unit: 'piece', size: 'medium', grams: 44 },
      ];

      expect(toGrams({ food: 'eggs', amount: 2, unit: 'large' }, portions)).toEqual({
        grams: 100,
        method: 'portion',
      });
      expect(toGrams({ food: 'eggs', amount: 3 }, portions)).toEqual({
        grams: 132,
        method: 'portion',
      });
    });

    it.each([
      [{ food: 'eggs', amount: 2 }, 88],
      [{ food: 'egg yolks', amount: 3, unit: 'large' }, 51],
      [{ food: 'onion', amount: 1, unit: 'medium' }, 110],
      [{ food: 'garlic', amount: 2, unit: 'cloves' }, 6],
      [{ food: 'celery', amount: 2, unit: 'stalks' }, 80],
      [{ food: 'bread', amount: 4, unit: 'slices' }, 112],
      [{ food: 'bananas', amount: 2, unit: 'шт' }, 236],
    ])('uses the piece table: %p -> %p g', (ingredient, grams) => {
      expect(toGrams(ingredient)).toEqual({ grams, method: 'piece' });
    });

    it.each([
      [{ food: 'chicken breasts', amount: 4 }, 'no piece weight for this food'],
      [{ food: 'cucumber', amount: 1, unit: 'large' }, 'no large piece weight'],
      [{ food: 'cream of mushroom soup', amount: 1, unit: 'can' }, '"can" without a weight'],
      [{ food: 'shrimp', amount: 1, unit: 'cup' }, 'no density for cup'],
      [{ food: 'salt', amount: 1, unit: 'smidgen' }, 'unknown unit "smidgen"'],
      [{ food: 'salt', amount: 0, unit: 'tsp' }, 'no amount'],
      [{ food: 'salt', amount: Number.NaN, unit: 'tsp' }, 'no amount'],
    ])('does not guess: %p', (ingredient, reason) => {
      expect(toGrams(ingredient)).toEqual({ grams: null, reason });
    });
  });

  describe('convertIngredients', () => {
    it('splits converted and unresolved ingredients, using the portions of each food', () => {
      const ingredients = [
        { food: 'onion', amount: 1, unit: 'cup', fdcId: '1' },
        { food: 'chicken breasts', amount: 2, unit: null, fdcId: '2' },
      ];
      const portions = new Map<string, FoodPortion[]>([['1', [{ unit: 'cup', grams: 160 }]]]);

      const report = convertIngredients(ingredients, (i) => portions.get(i.fdcId) ?? []);

      expect(report.converted).toEqual([
        { ingredient: ingredients[0], grams: 160, method: 'portion' },
      ]);
      expect(report.unresolved).toEqual([
        { ...ingredients[1], reason: 'no piece weight for this food' },
      ]);
    });
  });

  describe('formatUnresolvedReport', () => {
    it('groups the same problem and puts the most frequent first', () => {
      expect(
        formatUnresolvedReport([
          { food: 'Shrimp', amount: 1, unit: 'cup', reason: 'no density for cup' },
          { food: 'soup', amount: 1, unit: 'can', reason: '"can" without a weight' },
          { food: 'shrimp ', amount: 2, unit: 'cup', reason: 'no density for cup' },
          { food: 'chicken', amount: 2, reason: 'no piece weight for this food' },
        ]),
      ).toEqual([
        '2  cup | shrimp: no density for cup',
        '1  - | chicken: no piece weight for this food',
        '1  can | soup: "can" without a weight',
      ]);
    });
  });
});
