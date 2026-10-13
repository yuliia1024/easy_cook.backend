import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  compareNutrition,
  ControlRecipe,
  loadControlRecipes,
  validateControlRecipes,
} from './control-recipes';
import { loadSeedData, SeedData } from './seed-data';

describe('control recipes', () => {
  const macros = (kcal: number, proteinG: number, fatG: number, carbsG: number) => ({
    kcal,
    proteinG,
    fatG,
    carbsG,
  });

  /** 150 g dry rice (365 / 7.1 / 0.7 / 80) + optional 10 g oil, 2 servings. */
  const data: SeedData = {
    foods: [
      {
        slug: 'rice-white-dry',
        name: 'Rice',
        state: 'dried',
        kcalPer100g: 365,
        proteinG: 7.1,
        fatG: 0.7,
        carbsG: 80,
      },
      {
        slug: 'olive-oil',
        name: 'Oil',
        state: 'other',
        kcalPer100g: 884,
        proteinG: 0,
        fatG: 100,
        carbsG: 0,
      },
    ],
    recipes: [
      {
        slug: 'rice',
        name: 'Rice',
        instructions: 'Boil',
        mealType: 'lunch',
        dietType: [],
        servings: 2,
        ingredients: [
          { food: 'rice-white-dry', quantityG: 150 },
          { food: 'olive-oil', quantityG: 10, isOptional: true },
        ],
      },
    ],
  };
  const control: ControlRecipe = {
    slug: 'rice',
    servings: 2,
    calculation: ['rice-white-dry 150 g: 1.5 × (365 / 7.1 / 0.7 / 80)'],
    total: macros(547.5, 10.65, 1.05, 120),
    perServing: macros(273.75, 5.325, 0.525, 60),
  };

  describe('compareNutrition', () => {
    it('accepts values within the tolerance', () => {
      expect(
        compareNutrition(control, {
          total: macros(547.9, 10.7, 1.1, 120),
          perServing: macros(273.8, 5.3, 0.5, 60),
        }),
      ).toEqual([]);
    });

    it('lists every value outside it', () => {
      expect(
        compareNutrition(control, {
          total: macros(548.1, 10.65, 1.05, 120),
          perServing: macros(273.75, 5.5, 0.525, 60),
        }),
      ).toEqual([
        'total.kcal: expected 547.5, got 548.1',
        'perServing.proteinG: expected 5.325, got 5.5',
      ]);
    });

    it('flags a missing expected value', () => {
      const { total: _total, ...partial } = control;

      expect(compareNutrition(partial as ControlRecipe, control)).toHaveLength(4);
    });
  });

  describe('validateControlRecipes', () => {
    it('accepts hand-computed values that match the seed foods, optional ones excluded', () => {
      expect(validateControlRecipes([control], data)).toEqual([]);
    });

    it('rejects wrong values', () => {
      const wrong = { ...control, total: { ...control.total, kcal: 600 } };

      expect(validateControlRecipes([wrong], data)).toEqual([
        'control-recipes[0] "rice": total.kcal: expected 600, got 547.5',
      ]);
    });

    it.each([
      [{ slug: 'pilaf' }, 'no such recipe in recipes.json'],
      [{ servings: 3 }, 'servings 3, the recipe has 2'],
      [{ calculation: [] }, 'calculation is empty'],
    ])('rejects %p', (patch, message) => {
      expect(validateControlRecipes([{ ...control, ...patch }], data).join('\n')).toContain(
        message,
      );
    });

    it('rejects duplicates', () => {
      expect(validateControlRecipes([control, control], data)).toEqual([
        'control-recipes[1] "rice": duplicate slug',
      ]);
    });

    it('needs foods of foods.json', () => {
      const recipe = { ...data.recipes[0], ingredients: [{ food: 'usda_fdc:1', quantityG: 5 }] };

      expect(validateControlRecipes([control], { ...data, recipes: [recipe] })).toEqual([
        'control-recipes[0] "rice": ingredient "usda_fdc:1" is not a food of foods.json',
      ]);
    });
  });

  describe('loadControlRecipes', () => {
    it('reads the recipes of a directory', () => {
      const dir = mkdtempSync(join(tmpdir(), 'control-'));
      writeFileSync(join(dir, 'control-recipes.json'), JSON.stringify({ recipes: [control] }));

      expect(loadControlRecipes(dir)).toEqual([control]);
    });

    it('the committed file matches the committed seed data', () => {
      const controls = loadControlRecipes();

      expect(controls.length).toBeGreaterThanOrEqual(3);
      expect(validateControlRecipes(controls, loadSeedData())).toEqual([]);
    });
  });
});
