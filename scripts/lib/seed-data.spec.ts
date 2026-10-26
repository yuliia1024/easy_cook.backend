import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FoodSource, FoodState } from '../../src/common/constants';
import { ImportedFood } from './fdc';
import { estimateKcal, loadSeedData, parseFoodRef, SeedData, validateSeedData } from './seed-data';

describe('seed data', () => {
  const food = {
    slug: 'rice-white-dry',
    name: 'White rice, dry',
    nameEn: 'Rice, white, raw',
    state: 'dried',
    kcalPer100g: 365,
    proteinG: 7.1,
    fatG: 0.7,
    carbsG: 80,
  };
  const recipe = {
    slug: 'rice',
    name: 'Rice',
    instructions: 'Boil',
    mealType: 'lunch',
    dietType: ['vegan'],
    servings: 2,
    prepTimeMinutes: 20,
    ingredients: [{ food: 'rice-white-dry', quantityG: 150 }],
  };
  const importedFood: ImportedFood = {
    name: 'Quinoa, uncooked',
    nameEn: 'Quinoa, uncooked',
    kcalPer100g: 368,
    proteinG: 14.1,
    fatG: 6.07,
    carbsG: 64.2,
    state: FoodState.Raw,
    source: FoodSource.UsdaFdc,
    sourceId: '168874',
  };
  const data = (patch: Partial<SeedData> = {}): SeedData => ({
    foods: [food],
    importedFoods: [importedFood],
    recipes: [recipe],
    ...patch,
  });

  it('parses food references', () => {
    expect(parseFoodRef('rice-white-dry')).toEqual({ source: 'seed', sourceId: 'rice-white-dry' });
    expect(parseFoodRef('usda_fdc:171477')).toEqual({ source: 'usda_fdc', sourceId: '171477' });
  });

  it('estimates kcal with 4/9/4', () => {
    expect(estimateKcal({ proteinG: 10, fatG: 10, carbsG: 10 })).toBe(170);
  });

  it('accepts valid data', () => {
    expect(validateSeedData(data())).toEqual({ errors: [], warnings: [] });
  });

  describe('foods', () => {
    it.each([
      [{ slug: 'Rice Dry' }, 'slug must be kebab-case'],
      [{ name: ' ' }, 'name is empty'],
      [{ state: 'grilled' }, 'unknown state'],
      [{ kcalPer100g: -1 }, 'kcalPer100g must be a number'],
      [{ fatG: 120 }, 'fatG must be a number'],
      [{ proteinG: 50, fatG: 30, carbsG: 30 }, 'exceed 100 g'],
    ])('rejects %p', (patch, message) => {
      const { errors } = validateSeedData(data({ foods: [{ ...food, ...patch }] }));

      expect(errors.join('\n')).toContain(message);
    });

    it('rejects duplicate slugs', () => {
      expect(validateSeedData(data({ foods: [food, food] })).errors).toEqual([
        'foods[1] "rice-white-dry": duplicate slug',
      ]);
    });

    it('warns about unknown values and implausible kcal', () => {
      const { errors, warnings } = validateSeedData(
        data({
          foods: [
            { ...food, fatG: null },
            { ...food, slug: 'x', kcalPer100g: 100 },
          ],
        }),
      );

      expect(errors).toEqual([]);
      expect(warnings).toEqual([
        'foods[0] "rice-white-dry": fatG is unknown',
        'foods[1] "x": 100 kcal differs from 4/9/4 estimate 355 kcal',
      ]);
    });
  });

  describe('recipes', () => {
    it.each([
      [{ mealType: 'brunch' }, 'unknown meal type'],
      [{ dietType: ['paleo'] }, 'unknown diet tag'],
      [{ dietType: ['vegan', 'vegan'] }, 'duplicate diet tags'],
      [{ servings: 0 }, 'servings must be a positive integer'],
      [{ prepTimeMinutes: -5 }, 'prepTimeMinutes'],
      [{ instructions: '' }, 'instructions are empty'],
      [{ ingredients: [] }, 'has no ingredients'],
      [{ ingredients: [{ food: 'unknown', quantityG: 1 }] }, 'unknown food'],
      [
        { ingredients: [{ food: 'rice-white-dry', quantityG: 0 }] },
        'quantityG must be a positive number',
      ],
    ])('rejects %p', (patch, message) => {
      const { errors } = validateSeedData(data({ recipes: [{ ...recipe, ...patch }] }));

      expect(errors.join('\n')).toContain(message);
    });

    it('accepts references to the USDA foods of the seed', () => {
      const ingredients = [{ food: 'usda_fdc:168874', quantityG: 10 }];

      expect(validateSeedData(data({ recipes: [{ ...recipe, ingredients }] }))).toEqual({
        errors: [],
        warnings: [],
      });
    });

    it('leaves other imported food references to the seeding step', () => {
      const { errors, warnings } = validateSeedData(
        data({ recipes: [{ ...recipe, ingredients: [{ food: 'usda_fdc:1', quantityG: 10 }] }] }),
      );

      expect(errors).toEqual([]);
      expect(warnings[0]).toContain('checked when seeding');
    });
  });

  describe('loadSeedData', () => {
    let dir: string;
    const write = (file: string, content: unknown): void =>
      writeFileSync(join(dir, file), JSON.stringify(content));

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'seed-'));
      write('foods.json', { foods: [food] });
      write('usda-foods.json', [importedFood]);
      write('recipes.json', { recipes: [recipe] });
      write('menu-recipes.json', { $comment: 'menu', recipes: [{ ...recipe, slug: 'menu-rice' }] });
    });

    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('reads the foods, the USDA foods and the recipes of both recipe files', () => {
      expect(loadSeedData(dir)).toEqual({
        foods: [food],
        importedFoods: [importedFood],
        recipes: [recipe, { ...recipe, slug: 'menu-rice' }],
      });
    });
  });

  it('the committed seed files are valid', () => {
    const report = validateSeedData(loadSeedData());

    expect(report.errors).toEqual([]);
    expect(report.warnings.filter((w) => w.includes('checked when seeding'))).toEqual([]);
  });
});
