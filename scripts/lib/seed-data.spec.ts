import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FoodCategory, FoodSource, FoodState } from '../../src/common/constants';
import { ImportedFood } from './fdc';
import {
  acceptedRecipes,
  estimateKcal,
  formatRejections,
  loadSeedData,
  parseFoodRef,
  RecipeRejection,
  SeedData,
  SeedFoodCategories,
  validateSeedData,
} from './seed-data';

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
  const categories: SeedFoodCategories[] = [
    { food: 'rice-white-dry', name: 'White rice, dry', categories: [FoodCategory.Grain] },
    { food: 'usda_fdc:168874', name: 'Quinoa, uncooked', categories: [FoodCategory.Grain] },
  ];
  const data = (patch: Partial<SeedData> = {}): SeedData => ({
    foods: [food],
    importedFoods: [importedFood],
    recipes: [recipe],
    foodCategories: categories,
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
    expect(validateSeedData(data())).toEqual({ errors: [], warnings: [], rejected: [] });
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
      [{ ingredients: [] }, 'has no ingredients'],
      [
        { ingredients: [{ food: 'rice-white-dry', quantityG: 0 }] },
        'quantityG must be a positive number',
      ],
    ])('rejects %p', (patch, message) => {
      const { errors } = validateSeedData(data({ recipes: [{ ...recipe, ...patch }] }));

      expect(errors.join('\n')).toContain(message);
    });

    it('accepts references to the USDA foods of the seed', () => {
      const ingredients = [{ food: 'usda_fdc:168874', quantityG: 100 }];

      expect(validateSeedData(data({ recipes: [{ ...recipe, ingredients }] }))).toEqual({
        errors: [],
        warnings: [],
        rejected: [],
      });
    });

    it('does not check the import rules of a malformed recipe', () => {
      const report = validateSeedData(
        data({ recipes: [{ ...recipe, servings: 0, instructions: '' }] }),
      );

      expect(report.errors).toEqual(['recipes[0] "rice": servings must be a positive integer']);
      expect(report.rejected).toEqual([]);
    });
  });

  describe('rejected recipes', () => {
    const rejectedOf = (patch: Partial<SeedData>): RecipeRejection[] =>
      validateSeedData(data(patch)).rejected;

    it('rejects a recipe without instructions', () => {
      expect(rejectedOf({ recipes: [{ ...recipe, instructions: ' ' }] })).toEqual([
        { slug: 'rice', reasons: ['no instructions'] },
      ]);
    });

    it('rejects ingredients that are no food of foods.json or usda-foods.json', () => {
      const ingredients = [
        { food: 'unknown', quantityG: 100 },
        { food: 'usda_fdc:1', quantityG: 100 },
      ];

      expect(rejectedOf({ recipes: [{ ...recipe, ingredients }] })).toEqual([
        { slug: 'rice', reasons: ['ingredients not matched to a food: unknown, usda_fdc:1'] },
      ]);
    });

    it('rejects an ingredient whose food has no categories', () => {
      expect(rejectedOf({ foodCategories: [categories[1]] })).toEqual([
        { slug: 'rice', reasons: ['no categories in food-categories.json: rice-white-dry'] },
      ]);
    });

    it('rejects unknown nutrients and calories per serving out of range, with every reason', () => {
      const report = validateSeedData(
        data({
          foods: [{ ...food, fatG: null }],
          recipes: [
            recipe,
            { ...recipe, slug: 'tiny', ingredients: [{ food: 'rice-white-dry', quantityG: 10 }] },
          ],
        }),
      );

      expect(report.errors).toEqual([]);
      expect(report.rejected).toEqual([
        { slug: 'rice', reasons: ['rice-white-dry has no fatG'] },
        {
          slug: 'tiny',
          reasons: ['rice-white-dry has no fatG', '18.3 kcal per serving, outside 50-2500'],
        },
      ]);
    });

    it('only warns about unknown nutrients of an optional ingredient', () => {
      const ingredients = [
        ...recipe.ingredients,
        { food: 'usda_fdc:168874', quantityG: 5, isOptional: true },
      ];
      const report = validateSeedData(
        data({
          importedFoods: [{ ...importedFood, carbsG: null }],
          recipes: [{ ...recipe, ingredients }],
        }),
      );

      expect(report.rejected).toEqual([]);
      expect(report.warnings).toEqual(['recipes[0] "rice": usda_fdc:168874 has no carbsG']);
    });

    it('keeps the accepted recipes and formats the rejected ones', () => {
      const bad = { ...recipe, slug: 'bad', instructions: '' };
      const { rejected } = validateSeedData(data({ recipes: [recipe, bad] }));

      expect(acceptedRecipes([recipe, bad], rejected)).toEqual([recipe]);
      expect(formatRejections([...rejected, { slug: 'x', reasons: ['a', 'b'] }])).toEqual([
        'rejected bad: no instructions',
        'rejected x: a; b',
      ]);
    });
  });

  describe('food categories', () => {
    it.each([
      [{ food: 'unknown' }, 'unknown food'],
      [{ name: 'Rice' }, 'name must be "White rice, dry"'],
      [{ categories: [] }, 'has no categories'],
      [{ categories: ['bread'] }, 'unknown category "bread"'],
    ])('rejects %p', (patch, message) => {
      const { errors } = validateSeedData(
        data({
          foodCategories: [{ ...categories[0], ...patch } as SeedFoodCategories, ...categories],
        }),
      );

      expect(errors.join('\n')).toContain(message);
    });

    it('rejects a food listed twice', () => {
      const { errors } = validateSeedData(data({ foodCategories: [...categories, categories[0]] }));

      expect(errors).toEqual(['foodCategories[2] "rice-white-dry": duplicate food']);
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
      write('food-categories.json', { $comment: 'categories', foods: categories });
    });

    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('reads the foods, the USDA foods, the recipes of both recipe files and the food categories', () => {
      expect(loadSeedData(dir)).toEqual({
        foods: [food],
        importedFoods: [importedFood],
        recipes: [recipe, { ...recipe, slug: 'menu-rice' }],
        foodCategories: categories,
      });
    });
  });

  it('the committed seed files are valid and no recipe is rejected', () => {
    const report = validateSeedData(loadSeedData());

    expect(report.errors).toEqual([]);
    expect(report.rejected).toEqual([]);
  });
});
